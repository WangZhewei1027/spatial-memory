"use client";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fitSpan, TIMELINE_LABEL_WIDTH, TIMELINE_LEAD } from './timeline-scale';

const MAX_ZOOM = 32;
/** Visible time range, horizontal zoom and scroll of the timeline lanes. */
export function useTimelineView(contentEnd: number, time: number, playing: boolean) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewSpan] = useState(() => fitSpan(contentEnd));
  const compact = viewport > 0 && viewport < 640;
  const labelWidth = compact ? 170 : TIMELINE_LABEL_WIDTH;
  const labelOffset = labelWidth + TIMELINE_LEAD;
  // Extend the visible span when a cue reaches the edge.
  const span = contentEnd > viewSpan * .95 ? fitSpan(contentEnd) : viewSpan;
  const laneWidth = Math.round(Math.max(compact ? 160 : 280, viewport - labelOffset - 20) * zoom);
  // Time to keep at the same screen offset after a zoom.
  const anchor = useRef<{ time: number; offset: number } | null>(null);
  const zoomTo = (next: number, at: number, offset: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
    if (clamped !== zoom) { anchor.current = { time: at, offset }; setZoom(clamped); }
  };

  useLayoutEffect(() => {
    const element = scroller.current; if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth));
    observer.observe(element); setViewport(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current, target = anchor.current; anchor.current = null;
    if (element && target) element.scrollLeft = target.time / span * laneWidth - target.offset;
  }, [span, laneWidth]);
  // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer; a plain wheel scrolls.
  const wheelZoom = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelZoom.current = event => {
      const element = scroller.current!, offset = event.clientX - element.getBoundingClientRect().left - labelOffset;
      zoomTo(zoom * Math.exp(-event.deltaY / 200), Math.max(0, (element.scrollLeft + offset) / laneWidth * span), offset);
    };
  });
  useEffect(() => {
    const element = scroller.current; if (!element) return;
    const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); wheelZoom.current(event); } };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  // Page the view along with the playhead during playback.
  useEffect(() => {
    const element = scroller.current; if (!playing || !element) return;
    const at = time / span * laneWidth;
    if (at < element.scrollLeft || at > element.scrollLeft + element.clientWidth - labelOffset - 24) element.scrollLeft = at - 24;
  }, [playing, time, span, laneWidth, labelOffset]);

  return {
    scroller, span, laneWidth, labelWidth, compact, zoom, canZoomIn: zoom < MAX_ZOOM,
    /** Zoom by a factor, keeping the playhead where it is on screen. */
    zoomBy: (factor: number) => zoomTo(zoom * factor, time, time / span * laneWidth - (scroller.current?.scrollLeft ?? 0)),
  };
}
