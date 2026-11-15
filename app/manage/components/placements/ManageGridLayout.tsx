"use client";

import { useId, type ReactNode } from "react";
import { EllipsisVertical } from "lucide-react";
import { useMapPanelResize } from "./useMapPanelResize";
import { usePlacementText } from "./placement-texts";
import styles from "./ManageGridLayout.module.css";
import workbench from "./MapWorkbench.module.css";

interface ManageGridLayoutProps {
  /** Left list panel (placement list). */
  list: ReactNode;
  /** Contents of the bordered viewer panel (overlays + ViewerFrame). */
  viewer: ReactNode;
  /** Content placement controls, independent of the activity dialog. */
  sidebar: ReactNode;
  /** Fill the parent's height (collection detail under its header bar) instead of the viewport. */
  fill?: boolean;
  /** Map editor docks its inspectors over a stable map on narrow screens. */
  mapEditor?: boolean;
  mobilePanel?: "list" | "sidebar" | null;
  controls?: ReactNode;
}

/**
 * Skeleton and content share CSS geometry from their first paint. No measured
 * defaults or mount-time positioning changes are needed before resizing.
 */
export function ManageGridLayout({ list, viewer, sidebar, fill, mapEditor, mobilePanel, controls }: ManageGridLayoutProps) {
  const sizing = useMapPanelResize(!!mapEditor);
  const id = useId();
  const tx = usePlacementText();
  const divider = (panel: "list" | "sidebar") => mapEditor && <div
    className={`${styles.divider} ${panel === "list" ? styles.listDivider : styles.sidebarDivider}`}
    data-map-resizer={panel} role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={tx(`contentModel.integration.map.layout.resize.${panel}`)}
    title={tx(`contentModel.integration.map.layout.resize.${panel}`)}
    aria-controls={`${id}-${panel}`} aria-valuemin={sizing.minimum[panel]} aria-valuemax={Math.round(sizing.sizes[panel].max)} aria-valuenow={Math.round(sizing.sizes[panel].value)}
    {...sizing.handlers(panel)}><EllipsisVertical size={18} aria-hidden /></div>;
  return (
    <div className={`${styles.viewport} w-full ${fill ? "h-full" : "h-[calc(100dvh-var(--app-navbar-height))]"} overflow-y-auto overflow-x-hidden`}>
      <div ref={sizing.grid} style={mapEditor ? sizing.style : undefined} className={`${styles.grid} ${mapEditor ? `${styles.mapEditor} ${workbench.controls}` : ""}`} data-mobile-panel={mobilePanel ?? "none"} data-resizing={sizing.resizing || undefined}>
        {mapEditor && <div className={styles.controls}>{controls}</div>}
        <div id={`${id}-list`} data-map-panel="list" className={styles.list}>{list}</div>
        {divider("list")}
        <div data-map-panel="viewer" className={`${styles.viewer} relative overflow-hidden rounded-lg border bg-background`}>{viewer}</div>
        {divider("sidebar")}
        <div id={`${id}-sidebar`} data-map-panel="sidebar" className={styles.sidebar}>{sidebar}</div>
      </div>
    </div>
  );
}
