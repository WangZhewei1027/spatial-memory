"use client";

import type { ReactNode } from "react";
import styles from "./ManageGridLayout.module.css";

interface ManageGridLayoutProps {
  /** Left list panel (placement list). */
  list: ReactNode;
  /** Contents of the bordered viewer panel (overlays + ViewerFrame). */
  viewer: ReactNode;
  /** Content placement controls, independent of the activity dialog. */
  sidebar: ReactNode;
  /** Fill the parent's height (collection detail under its header bar) instead of the viewport. */
  fill?: boolean;
}

/**
 * Skeleton and content share CSS geometry from their first paint. No measured
 * defaults or mount-time positioning changes are needed for these fixed panels.
 */
export function ManageGridLayout({ list, viewer, sidebar, fill }: ManageGridLayoutProps) {
  return (
    <div className={`${styles.viewport} w-full ${fill ? "h-full" : "h-[calc(100dvh-var(--app-navbar-height))]"} overflow-y-auto overflow-x-hidden`}>
      <div className={styles.grid}>
        <div data-map-panel="list" className={styles.list}>{list}</div>
        <div data-map-panel="viewer" className={`${styles.viewer} relative overflow-hidden rounded-lg border bg-background`}>{viewer}</div>
        <div data-map-panel="sidebar" className={styles.sidebar}>{sidebar}</div>
      </div>
    </div>
  );
}
