"use client";
import { useEffect, useRef } from "react";
import type { SceneEditorState } from "./useSceneDocument";
export function useSceneEditorShortcuts(editor: SceneEditorState) {
  const actions = useRef(editor); actions.current = editor;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault();
        if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur();
        void actions.current.save(); return; }
      if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (!actions.current.readOnly) (event.shiftKey ? actions.current.redo : actions.current.undo)(); }
      if (event.code === "Space") {
        if (event.target instanceof HTMLElement && event.target.closest('button, a, [role="button"], [role="tab"]')) return;
        event.preventDefault(); actions.current.play();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
}
