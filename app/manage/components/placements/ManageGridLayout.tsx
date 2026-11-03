"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Responsive, useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// 网格布局配置
// lg / md：三栏并排；sm 及以下：Viewer 置顶，其余面板依次纵向堆叠，方便移动端滚动浏览
const LAYOUTS: Partial<Record<string, Layout>> = {
  lg: [
    { i: "assetManager", x: 0, y: 0, w: 3, h: 12, minW: 2, minH: 6 },
    { i: "viewer", x: 3, y: 0, w: 6, h: 12, minW: 4, minH: 6 },
    { i: "sidebar", x: 9, y: 0, w: 3, h: 12, minW: 2, minH: 6 },
  ],
  md: [
    { i: "assetManager", x: 0, y: 0, w: 2, h: 12, minW: 2, minH: 6 },
    { i: "viewer", x: 2, y: 0, w: 6, h: 12, minW: 4, minH: 6 },
    { i: "sidebar", x: 8, y: 0, w: 2, h: 12, minW: 2, minH: 6 },
  ],
  sm: [
    { i: "viewer", x: 0, y: 0, w: 6, h: 12, minW: 3, minH: 6 },
    { i: "assetManager", x: 0, y: 12, w: 3, h: 10, minW: 2, minH: 6 },
    { i: "sidebar", x: 3, y: 12, w: 3, h: 10, minW: 2, minH: 6 },
  ],
  xs: [
    { i: "viewer", x: 0, y: 0, w: 4, h: 11, minW: 2, minH: 6 },
    { i: "assetManager", x: 0, y: 11, w: 4, h: 9, minW: 2, minH: 6 },
    { i: "sidebar", x: 0, y: 20, w: 4, h: 9, minW: 2, minH: 6 },
  ],
  xxs: [
    { i: "viewer", x: 0, y: 0, w: 2, h: 11, minW: 1, minH: 6 },
    { i: "assetManager", x: 0, y: 11, w: 2, h: 9, minW: 1, minH: 6 },
    { i: "sidebar", x: 0, y: 20, w: 2, h: 9, minW: 1, minH: 6 },
  ],
};

// Activity controls live in the list. Reclaim the unused sidebar for the map;
// on narrow screens the remaining list takes the full row below the viewer.
const TWO_PANEL_LAYOUTS: Partial<Record<string, Layout>> = {
  lg: [
    { i: "assetManager", x: 0, y: 0, w: 3, h: 12, minW: 2, minH: 6 },
    { i: "viewer", x: 3, y: 0, w: 9, h: 12, minW: 4, minH: 6 },
  ],
  md: [
    { i: "assetManager", x: 0, y: 0, w: 2, h: 12, minW: 2, minH: 6 },
    { i: "viewer", x: 2, y: 0, w: 8, h: 12, minW: 4, minH: 6 },
  ],
  sm: [
    { i: "viewer", x: 0, y: 0, w: 6, h: 12, minW: 3, minH: 6 },
    { i: "assetManager", x: 0, y: 12, w: 6, h: 10, minW: 2, minH: 6 },
  ],
  xs: [
    { i: "viewer", x: 0, y: 0, w: 4, h: 11, minW: 2, minH: 6 },
    { i: "assetManager", x: 0, y: 11, w: 4, h: 9, minW: 2, minH: 6 },
  ],
  xxs: [
    { i: "viewer", x: 0, y: 0, w: 2, h: 11, minW: 1, minH: 6 },
    { i: "assetManager", x: 0, y: 11, w: 2, h: 9, minW: 1, minH: 6 },
  ],
};

interface ManageGridLayoutProps {
  /** Left list panel (placement list). */
  list: ReactNode;
  /** Contents of the bordered viewer panel (overlays + ViewerFrame). */
  viewer: ReactNode;
  /** Omit when all controls are in the list; the viewer uses the remaining space. */
  sidebar?: ReactNode;
  /** Fill the parent's height (collection detail under its header bar) instead of the viewport. */
  fill?: boolean;
}

/**
 * The responsive /manage workspace grid used by each collection map.
 */
export function ManageGridLayout({ list, viewer, sidebar, fill }: ManageGridLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [rowHeight, setRowHeight] = useState(50);
  const hasSidebar = sidebar != null;

  // 动态计算 rowHeight
  useEffect(() => {
    if (!containerRef.current || !mounted) return;

    const updateRowHeight = () => {
      const containerHeight = containerRef.current?.clientHeight || 0;
      // 让 12 行恰好填满可视高度：扣除上下 containerPadding(12*2) 与 11 个行间距(12*11)
      const ROWS = 12;
      const verticalGutter = 12 * 2 + 12 * (ROWS - 1);
      const calculatedRowHeight = Math.max(32, Math.floor((containerHeight - verticalGutter) / ROWS));
      setRowHeight(calculatedRowHeight);
    };

    updateRowHeight();

    const resizeObserver = new ResizeObserver(updateRowHeight);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, mounted]);

  return (
    <div ref={containerRef} className={`w-full ${fill ? "h-full" : "h-[calc(100dvh-var(--app-navbar-height))]"} overflow-y-auto overflow-x-hidden`}>
      {mounted && (
        <Responsive
          className="layout"
          layouts={hasSidebar ? LAYOUTS : TWO_PANEL_LAYOUTS}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={rowHeight}
          width={width}
          margin={[12, 12]}
          containerPadding={[12, 12]}
          resizeConfig={{ enabled: false }}
          dragConfig={{ enabled: false }}
        >
          {/* 资产 / 投放列表 */}
          <div key="assetManager">{list}</div>

          {/* Viewer 面板 */}
          <div key="viewer" className="relative bg-background border rounded-lg overflow-hidden">
            {viewer}
          </div>

          {/* Sidebar 面板 */}
          {hasSidebar && <div key="sidebar">
            {sidebar}
          </div>}
        </Responsive>
      )}
    </div>
  );
}
