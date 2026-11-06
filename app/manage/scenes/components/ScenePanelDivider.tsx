"use client";

import { Ellipsis, EllipsisVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { useScenePanelSize } from "./useScenePanelSize";

export function ScenePanelDivider({ panel, sizing, controls }: {
  panel: "library" | "timeline"; sizing: ReturnType<typeof useScenePanelSize>; controls: string;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const library = panel === "library";
  const name = library ? (zh ? "素材库" : "asset library") : (zh ? "时间轴" : "timeline");
  const label = sizing.collapsed ? (zh ? `展开${name}` : `Expand ${name}`) : (zh ? `拖动调整${name}，点击收起` : `Drag to resize ${name}, click to collapse`);
  const Icon = library ? EllipsisVertical : Ellipsis;
  return <button type="button" className={`scene-panel-divider scene-${panel}-divider`}
    aria-label={label} title={label} aria-expanded={!sizing.collapsed} aria-controls={controls}
    {...sizing.handlers} onClick={event => {
      // Assistive technology can activate a button without pointer or key events.
      if (event.detail === 0) sizing.toggle();
    }}>
    <Icon aria-hidden size={18} />
  </button>;
}
