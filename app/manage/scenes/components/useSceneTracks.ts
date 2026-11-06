"use client";
import type { CompositionContent } from '@/lib/scene/protocol';
import { editNode, groupNodes, moveNode, removeNodes, renameNode, ungroup, type HierarchyFailure, type SceneNode } from '@/lib/scene/hierarchy-authoring';
import type { SceneEditorState } from './useSceneDocument';

export interface SceneTrackActions {
  edit(id: string, edit: <N extends SceneNode>(node: N) => N): void;
  group(): void; ungroup(id: string): void; remove(ids: string[]): void; rename(id: string, name: string): void;
  move(id: string, target: { parent?: string; before?: string }): void;
}

/** Track edits from the timeline headers, each one undoable document commit. */
export function useSceneTracks(editor: SceneEditorState, selectedIds: string[], select: (ids: string[]) => void, text: (zh: string, en: string) => string): SceneTrackActions {
  const content = (edit: (content: CompositionContent) => CompositionContent) => {
    if (editor.readOnly) return;
    editor.commit(current => ({ ...current, definition: { ...current.definition, content: edit(current.definition.content) } }));
  };
  const failed = (reason: HierarchyFailure) => editor.reportError({
    cycle: text('不能把分组移到它自己里面。', 'A group cannot be moved into itself.'),
  }[reason]);
  /** Apply a hierarchy edit that may refuse; the failure is reported instead of committing. */
  const attempt = (edit: (content: CompositionContent) => { ok: true; content: CompositionContent } | { ok: false; reason: HierarchyFailure }) => {
    let failure: HierarchyFailure | undefined;
    content(current => { const result = edit(current); if (result.ok) return result.content; failure = result.reason; return current; });
    if (failure) failed(failure);
    return !failure;
  };
  return {
    edit: (id, edit) => content(current => editNode(current, id, edit)),
    group() {
      const id = `group_${crypto.randomUUID().slice(0, 8)}`;
      if (attempt(current => {
        const taken = new Set((current.groups ?? []).map(group => group.name));
        let n = 1; while (taken.has(text(`分组 ${n}`, `Group ${n}`))) n++;
        return groupNodes(current, selectedIds, { id, name: text(`分组 ${n}`, `Group ${n}`) });
      })) select([id]);
    },
    ungroup(id) {
      let members: string[] = [];
      content(current => { members = [...current.instances, ...(current.groups ?? [])].filter(node => node.parent === id).map(node => node.id); return ungroup(current, id); });
      select(members);
    },
    move: (id, target) => { attempt(current => moveNode(current, id, target)); },
    remove(ids) { content(current => removeNodes(current, ids)); select(selectedIds.filter(id => !ids.includes(id))); },
    rename: (id, name) => content(current => renameNode(current, id, name)),
  };
}
