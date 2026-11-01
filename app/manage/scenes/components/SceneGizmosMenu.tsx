"use client";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, CircleHelp, Grid3X3, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/typography";

/** Scene-view preferences only; changing a guide never edits the scene document. */
export function SceneGizmosMenu({ grid, labels, onGrid, onLabels }: {
  grid: boolean; labels: boolean; onGrid(): void; onLabels(): void;
}) {
  const { i18n } = useTranslation();
  const text = (zh: string, en: string) => i18n.language.startsWith("zh") ? zh : en;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((node: HTMLDivElement | null) => setContainer(node?.closest<HTMLElement>(".scene-workspace-theme") ?? null), []);
  return <div ref={anchorRef} className="scene-gizmos-control">
    <Button variant={labels ? "secondary" : "ghost"} size="icon" className="scene-label-toggle" aria-label={text("辅助标签", "Guide labels")} aria-pressed={labels}
      title={text(labels ? "隐藏辅助标签" : "显示辅助标签", labels ? "Hide guide labels" : "Show guide labels")} onClick={onLabels}><CircleHelp /></Button>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant={open ? "secondary" : "ghost"} size="icon" className="scene-gizmos-trigger" aria-label={text("辅助显示设置", "Scene guide settings")} title="Gizmos">
        <ChevronDown aria-hidden="true" />
      </Button></PopoverTrigger>
      <PopoverContent portalContainer={container} side="bottom" align="start" collisionPadding={8} className="scene-gizmos-popover" aria-label={text("辅助显示", "Scene guides")}>
        <div className="scene-gizmo-option"><Grid3X3 aria-hidden="true" /><Label htmlFor={`${id}-grid`}>{text("网格 · 1 米", "Grid · 1 m")}</Label><Checkbox id={`${id}-grid`} checked={grid} onCheckedChange={onGrid} /></div>
        <div className="scene-gizmo-option"><Tags aria-hidden="true" /><Label htmlFor={`${id}-labels`}>{text("文字标签", "Labels")}</Label><Checkbox id={`${id}-labels`} checked={labels} onCheckedChange={onLabels} aria-describedby={`${id}-labels-note`} /></div>
        <Text id={`${id}-labels-note`} as="p" variant="bodyXs" tone="subdued" className="scene-gizmo-description">{text("原点、坐标尺、虚拟相机与米制提示", "Origin, rulers, virtual camera and meter hint")}</Text>
      </PopoverContent>
    </Popover>
  </div>;
}
