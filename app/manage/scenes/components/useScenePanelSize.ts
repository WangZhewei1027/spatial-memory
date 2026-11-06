"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type Panel = "library" | "timeline";
const settings = {
  library: { min: 200, collapseAt: 144, key: "scene-library-width" },
  timeline: { min: 140, collapseAt: 88, key: "scene-timeline-height" },
};

/** A stored size of zero means collapsed; pointer coordinates use the visible panel edge. */
export function useScenePanelSize(panel: Panel, compact = false) {
  const horizontal = panel === "library";
  const { min, collapseAt, key } = settings[panel];
  const storageKey = compact ? key + "-compact" : key;
  const fallback = compact ? 0 : undefined;
  const [size, setSize] = useState<number | undefined>(fallback);
  const previous = useRef<number | undefined>(undefined);
  const drag = useRef<{ at: number; initial: number; original?: number; moved: boolean } | null>(null);

  useEffect(() => {
    let saved = fallback;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null && Number.isFinite(Number(raw)) && Number(raw) >= 0) saved = Number(raw) === 0 ? 0 : Math.max(min, Number(raw));
    } catch { /* The panels also work without storage. */ }
    previous.current = undefined;
    setSize(saved);
  }, [storageKey, min, fallback]);

  const apply = (value: number | undefined) => {
    setSize(value);
    try {
      if (value === undefined) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(value));
    } catch { /* Session-only layout. */ }
  };
  const measure = (handle: HTMLElement) => {
    const box = handle.parentElement!.getBoundingClientRect();
    return horizontal ? box.width : box.height;
  };
  const bounded = (value: number, handle: HTMLElement) => {
    const container = handle.parentElement!.parentElement!;
    const limit = horizontal
      ? Math.min(640, compact ? container.clientWidth - 32 : container.clientWidth * .55)
      : Math.min(window.innerHeight * .7, container.clientHeight - 172);
    return Math.max(0, Math.round(Math.min(limit, Math.max(min, value))));
  };
  const coordinate = (event: PointerEvent) => horizontal ? event.clientX : -event.clientY;
  const dragSize = (initial: number, delta: number, handle: HTMLElement) => {
    if (initial + delta < (initial === 0 ? 12 : collapseAt)) return 0;
    return bounded(initial + delta, handle);
  };
  const close = () => { if (size !== 0) previous.current = size; apply(0); };
  const toggle = () => size === 0 ? apply(previous.current ?? (compact ? 320 : undefined)) : close();

  return {
    size, collapsed: size === 0, close, toggle,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0 || !event.isPrimary) return;
        drag.current = { at: coordinate(event), initial: measure(event.currentTarget), original: size, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const gesture = drag.current;
        if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = coordinate(event) - gesture.at;
        if (!gesture.moved && Math.abs(delta) < 4) return;
        gesture.moved = true;
        const next = dragSize(gesture.initial, delta, event.currentTarget);
        if (horizontal && next === 0) {
          previous.current = gesture.initial;
          drag.current = null;
          apply(0);
        } else setSize(next);
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const gesture = drag.current;
        if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        drag.current = null;
        const delta = coordinate(event) - gesture.at;
        if (!gesture.moved && Math.abs(delta) < 4) return toggle();
        const next = dragSize(gesture.initial, delta, event.currentTarget);
        if (!next && gesture.initial > 0) previous.current = gesture.initial;
        apply(next);
      },
      onLostPointerCapture() {
        if (drag.current) setSize(drag.current.original);
        drag.current = null;
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        const increase = horizontal ? "ArrowRight" : "ArrowUp";
        const decrease = horizontal ? "ArrowLeft" : "ArrowDown";
        if (!["Enter", " ", "Home", increase, decrease].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const actual = measure(event.currentTarget);
        if (event.key === "Enter" || event.key === " ") toggle();
        else if (event.key === "Home" || (event.key === decrease && actual <= min)) close();
        else apply(bounded(actual + (event.key === increase ? 24 : -24), event.currentTarget));
      },
    },
  };
}
