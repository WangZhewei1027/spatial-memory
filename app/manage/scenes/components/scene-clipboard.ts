import { newAlias, type EditorDefinition } from "../../lib/scene-document";
import { trackRows, isGroup, type SceneNode } from "@/lib/scene/hierarchy-authoring";
import { apply } from "@/packages/scene-authoring/src/operations";
import type { Operation } from "@/packages/scene-authoring/src/types";
import type { TransformKeyframe } from "@/lib/scene/protocol";

type Content = EditorDefinition["content"];

export function copyTracks(content: Content, ids: string[], nameOf: (node: SceneNode) => string) {
  const selected = new Set(ids);
  const included = new Set<string>();
  const roots = new Map<string, string>();
  const assets = new Map<string, string>();
  const nodes: SceneNode[] = [];
  for (const { node } of trackRows(content)) {
    const inGroup = !!node.parent && included.has(node.parent);
    if (!selected.has(node.id) && !inGroup) continue;
    if (!inGroup) roots.set(node.id, nameOf(node));
    included.add(node.id);
    nodes.push(structuredClone(node));
    if (!isGroup(node) && node.asset) assets.set(node.asset, content.assets[node.asset].assetId);
  }
  return nodes.length ? { nodes, roots, assets } : null;
}
export type TrackClipboard = NonNullable<ReturnType<typeof copyTracks>>;

/** Per-paste shift (metres, parent space) so an in-place copy is visibly separate from its source. */
export const PASTE_OFFSET = [0.25, 0, 0.25] as const;

/** Shift a pasted root and its position keys; group members keep their local transforms. */
function offsetNode<N extends SceneNode>(node: N, steps: number): N {
  if (!steps) return node;
  const position = node.position.map((value, axis) => value + PASTE_OFFSET[axis] * steps) as N["position"];
  const tracks: Record<string, TransformKeyframe[] | undefined> = { ...node.tracks };
  (["x", "y", "z"] as const).forEach((axis, index) => {
    const frames = tracks[`position.${axis}`], delta = PASTE_OFFSET[index] * steps;
    if (frames && delta) tracks[`position.${axis}`] = frames.map(frame => ({ ...frame, value: frame.value + delta }));
  });
  return { ...node, position, ...(node.tracks ? { tracks } : {}) };
}

/**
 * Materialize the copy-time snapshot even after the original track or alias was deleted.
 * `steps` offsets the pasted roots by that many `PASTE_OFFSET`s; repeated pastes pass 1, 2, 3…
 */
export function pasteTracks(document: EditorDefinition, snapshot: TrackClipboard, copySuffix: string, steps = 1) {
  const content = document.content;
  const operations: Operation[] = [];
  const aliases = new Map<string, string>();
  for (const [original, assetId] of snapshot.assets) {
    let alias = Object.keys(content.assets).find(key => content.assets[key].assetId === assetId);
    if (!alias) {
      alias = Object.hasOwn(content.assets, original) ? newAlias() : original;
      operations.push({ type: "asset.set", alias, assetId });
    }
    aliases.set(original, alias);
  }
  const ids = new Map(snapshot.nodes.map(node => [node.id, `${isGroup(node) ? "group" : "object"}_${crypto.randomUUID().slice(0, 24)}`]));
  const last = content.instances.reduce((at, item, index) => ids.has(item.id) ? index : at, -1);
  const beforeId = last >= 0 ? content.instances[last + 1]?.id : undefined;
  for (const original of snapshot.nodes) {
    const root = snapshot.roots.has(original.id);
    const node = root ? offsetNode(structuredClone(original), steps) : structuredClone(original);
    node.id = ids.get(original.id)!;
    if (root) node.name = `${snapshot.roots.get(original.id)} ${copySuffix}`;
    if (node.parent) {
      const parentCopy = ids.get(node.parent);
      if (parentCopy) node.parent = parentCopy;
      else if (!content.groups?.some(group => group.id === node.parent)) delete node.parent;
    }
    if (!isGroup(node) && node.asset) node.asset = aliases.get(node.asset)!;
    if (isGroup(node)) operations.push({ type: "node.add", kind: "group", node });
    else operations.push({ type: "node.add", kind: "instance", node, ...(beforeId ? { beforeId } : {}) });
  }
  const result = apply(document, operations);
  if (!result.ok) throw new Error(result.errors.map(issue => issue.message).join("\n"));
  return { definition: result.document, selected: [...snapshot.roots.keys()].map(id => ids.get(id)!) };
}
