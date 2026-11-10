"use client";
import { useEffect, useRef } from "react";
import type { SceneEditorState } from "./useSceneDocument";
import type { TrackClipboard } from "./scene-clipboard";

function editingField(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [role="listbox"]');
}

interface TrackShortcuts {
  copy(): TrackClipboard | null;
  /** `steps` counts pastes of this copy, so repeated pastes do not stack on one spot. */
  paste(snapshot: TrackClipboard, steps: number): void;
  remove(): void;
  hasSelection: boolean;
  selectAll(): void;
  clear(): void;
}

export function useSceneEditorShortcuts(editor: SceneEditorState, tracks: TrackShortcuts) {
  const actions = useRef({ editor, tracks });
  actions.current = { editor, tracks };
  useEffect(() => {
    let clipboard: TrackClipboard | null = null, pastes = 0;
    const copiedText = (event: ClipboardEvent) => {
      if (editingField(event.target)) clipboard = null;
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const { editor, tracks } = actions.current;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur();
        void editor.save(); return;
      }
      if (editingField(event.target)) return;
      if (!(event.target instanceof Element) || !event.target.closest(".scene-native-stage")) return;
      const command = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      if (command && event.key.toLowerCase() === "a") { event.preventDefault(); tracks.selectAll(); return; }
      if (event.key === "Escape") { event.preventDefault(); tracks.clear(); return; }
      if (command && event.key.toLowerCase() === "c") {
        const snapshot = tracks.copy();
        if (snapshot) { clipboard = snapshot; pastes = 0; event.preventDefault(); }
        return;
      }
      if (command && event.key.toLowerCase() === "v" && clipboard && !editor.readOnly && !editor.playing) {
        event.preventDefault();
        if (!event.repeat) tracks.paste(clipboard, ++pastes);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!event.repeat && tracks.hasSelection && !editor.readOnly && !editor.playing) {
          event.preventDefault(); tracks.remove();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (!editor.readOnly) (event.shiftKey ? editor.redo : editor.undo)(); }
      if (event.code === "Space") {
        if (event.target instanceof Element && event.target.closest('button, a, [role="button"], [role="tab"]')) return;
        event.preventDefault(); editor.play();
      }
    };
    window.addEventListener("copy", copiedText);
    window.addEventListener("cut", copiedText);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("copy", copiedText);
      window.removeEventListener("cut", copiedText);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
}
