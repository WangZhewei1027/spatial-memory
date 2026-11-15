"use client";

import Link from "next/link";
import { Anchor, ExternalLink, Eye } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import type { PlacementDto } from "@/lib/content-model/contracts";
import { ContentStatusBadge } from "@/app/manage/content/ContentStatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { teamHref } from "../../lib/content-context";
import { placementFileType, placementScopeKey } from "../../lib/placement-to-viewer";
import { usePlacementStore } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";
import { PlacementPreview } from "./PlacementPreview";

interface PlacementSourceSectionProps {
  placement: PlacementDto;
  editable: boolean;
  formDirty: boolean;
}

/**
 * Read-only facts about the content the placement plays: the source asset or
 * scene, its saved content, and where to maintain the source.
 */
export function PlacementSourceSection({ placement }: PlacementSourceSectionProps) {
  const { tx, organizationId, workspaceId } = usePlacementMap();
  const [previewOpen, setPreviewOpen] = useState(false);
  const target = placement.target;
  const scopeKey = placementScopeKey(organizationId, workspaceId);
  const detail = usePlacementStore((state) => (state.scopeKey === scopeKey && target.kind === "asset" ? state.assetDetails[target.asset_id] : undefined));
  const canReadSource = target.kind === "scene" || detail?.capabilities.can_read === true;
  const type = placementFileType(placement);
  const sourceArchived = target.kind === "asset" ? target.asset_state === "archived" : target.scene_state === "archived";
  const href = target.kind === "asset"
    ? teamHref(`/manage/assets/${target.asset_id}`, organizationId)
    : teamHref(`/manage/scenes/${target.scene_id}`, organizationId);
  const sourceName = (target.kind === "asset" ? target.asset_name : target.scene_name) || tx("contentModel.integration.map.source.unnamed");

  return (
    <section className="flex items-start gap-2 border-b pb-3" aria-label={tx("contentModel.integration.map.section.source")}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Text as="p" variant="bodySm" fontWeight="medium" truncate title={sourceName} className="min-w-0 flex-1">{sourceName}</Text>
          <Badge variant="secondary" className="px-1.5 py-0 text-xs">{tx(`contentModel.integration.map.type.${type}`)}</Badge>
          {sourceArchived && <ContentStatusBadge kind="archived" />}
        </div>
      </div>

      <div className="flex shrink-0 gap-1">
        {target.kind === "asset" && <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label={tx("contentModel.integration.map.source.preview")} title={tx("contentModel.integration.map.source.preview")}><Eye className="size-4" aria-hidden /></Button></DialogTrigger>
          <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
            <DialogHeader><DialogTitle>{sourceName}</DialogTitle></DialogHeader>
            {previewOpen && <PlacementPreview placement={placement} />}
          </DialogContent>
        </Dialog>}
      {canReadSource && <>
        <Button variant="ghost" size="icon" asChild>
          <Link href={href} target="_blank" rel="noopener noreferrer" aria-label={tx(target.kind === "asset" ? "contentModel.integration.map.source.openAsset" : "contentModel.integration.map.source.openScene")} title={tx(target.kind === "asset" ? "contentModel.integration.map.source.openAsset" : "contentModel.integration.map.source.openScene")}>
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        </Button>
        {type === "anchor" && target.kind === "asset" && (
          <Button variant="ghost" size="sm" onClick={() => usePlacementStore.getState().selectAnchor(target.asset_id)}>
            <Anchor className="size-4" aria-hidden />
            {tx("contentModel.integration.map.source.openAnchor")}
          </Button>
        )}
      </>}
      </div>
    </section>
  );
}
