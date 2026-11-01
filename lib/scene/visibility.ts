import type { CompositionContent } from './protocol';

type Content = Pick<CompositionContent, 'instances' | 'groups'>;

/** Own visibility and ancestor visibility are independent; showing a group restores its members' choices. */
export function hiddenNodeIds(content: Content): Set<string> {
  const nodes = [...(content.groups ?? []), ...content.instances];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const hidden = new Set<string>();
  for (const node of nodes) {
    const visited = new Set<string>();
    for (let at: typeof node | undefined = node; at && !visited.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
      if (at.hidden) { hidden.add(node.id); break; }
      visited.add(at.id);
    }
  }
  return hidden;
}

export function setNodeVisible<N extends { hidden?: boolean }>(node: N, visible: boolean): N {
  if (!visible) return { ...node, hidden: true };
  const { hidden: _hidden, ...rest } = node;
  return rest as N;
}

/** Lower authoring visibility to the existing schema-8 opacity contract without rewriting the saved curves. */
export function compileVisibility<T extends Content>(content: T): T {
  const hidden = hiddenNodeIds(content);
  return {
    ...content,
    ...(content.groups ? { groups: content.groups.map(group => setNodeVisible(group, true)) } : {}),
    instances: content.instances.map(instance => {
      const clean = setNodeVisible(instance, true);
      if (!hidden.has(instance.id)) return clean;
      const { tracks, ...rest } = clean;
      const { opacity: _opacity, ...remaining } = tracks ?? {};
      return { ...rest, opacity: 0, ...(Object.keys(remaining).length ? { tracks: remaining } : {}) };
    }),
  };
}
