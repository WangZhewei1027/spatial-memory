export interface SelectionModifiers { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }

/** Selection order ends with the active object; range anchors survive repeated Shift clicks. */
export function selectSceneNodes(selected: string[], id: string, order: string[], anchor: string | null, modifiers: SelectionModifiers) {
  if (modifiers.shiftKey && anchor && order.includes(anchor) && order.includes(id)) {
    const a = order.indexOf(anchor), b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const ids = modifiers.ctrlKey || modifiers.metaKey ? [...new Set([...selected, ...range])] : range;
    return { ids: [...ids.filter(value => value !== id), id], anchor };
  }
  if (modifiers.ctrlKey || modifiers.metaKey) return {
    ids: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id], anchor: id,
  };
  return { ids: [id], anchor: id };
}
