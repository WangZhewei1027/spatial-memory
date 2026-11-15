"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

type Panel = "list" | "sidebar";
type Widths = Partial<Record<Panel, number>>;
const minimum = { list: 240, sidebar: 320 };
const mapMinimum = 320;
const maximum = 480;

/** CSS owns first-paint and responsive geometry; dragging only changes preferred widths. */
export function useMapPanelResize(enabled: boolean) {
  const grid = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Widths>({});
  const [resizing, setResizing] = useState(false);
  const gesture = useRef<{ panel: Panel; pointerId: number; at: number; width: number; original: Widths } | null>(null);
  const [sizes, setSizes] = useState({ list: { value: 320, max: maximum }, sidebar: { value: 384, max: maximum } });

  const measure = useCallback((panel: Panel) => {
    const value = grid.current?.querySelector(`[data-map-panel="${panel}"]`)?.getBoundingClientRect().width ?? minimum[panel];
    const map = grid.current?.querySelector('[data-map-panel="viewer"]')?.getBoundingClientRect().width ?? mapMinimum;
    return { value, max: Math.max(minimum[panel], Math.min(maximum, value + map - mapMinimum)) };
  }, []);

  useEffect(() => {
    if (!enabled || !grid.current) return;
    const observer = new ResizeObserver(() => {
      const next = { list: measure("list"), sidebar: measure("sidebar") };
      setSizes(current => current.list.value === next.list.value && current.list.max === next.list.max && current.sidebar.value === next.sidebar.value && current.sidebar.max === next.sidebar.max ? current : next);
    });
    observer.observe(grid.current);
    grid.current.querySelectorAll('[data-map-panel]').forEach(panel => observer.observe(panel));
    return () => observer.disconnect();
  }, [enabled, measure]);

  const apply = (panel: Panel, value: number) => {
    const bounded = Math.round(Math.max(minimum[panel], Math.min(measure(panel).max, value)));
    setWidths(current => ({ ...current, [panel]: bounded }));
  };
  const reset = (panel: Panel) => setWidths(current => ({ ...current, [panel]: undefined }));
  const cancel = () => {
    if (gesture.current) setWidths(gesture.current.original);
    gesture.current = null;
    setResizing(false);
  };
  const handlers = (panel: Panel) => ({
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      gesture.current = { panel, pointerId: event.pointerId, at: event.clientX, width: measure(panel).value, original: widths };
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizing(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const drag = gesture.current;
      if (!drag || drag.panel !== panel || drag.pointerId !== event.pointerId) return;
      apply(panel, drag.width + (event.clientX - drag.at) * (panel === "list" ? 1 : -1));
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (gesture.current?.pointerId !== event.pointerId) return;
      gesture.current = null;
      setResizing(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onDoubleClick: () => reset(panel),
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return cancel();
      if (event.key === "Enter") return reset(panel);
      const { value, max } = measure(panel);
      const delta = (event.key === "ArrowRight" ? 24 : -24) * (panel === "list" ? 1 : -1);
      apply(panel, event.key === "Home" ? minimum[panel] : event.key === "End" ? max : value + delta);
    },
  });
  const style: CSSProperties & { "--map-list-width"?: string; "--map-sidebar-width"?: string } = {
    "--map-list-width": widths.list === undefined ? undefined : `${widths.list}px`,
    "--map-sidebar-width": widths.sidebar === undefined ? undefined : `${widths.sidebar}px`,
  };
  return { grid, style, resizing, handlers, sizes, minimum };
}
