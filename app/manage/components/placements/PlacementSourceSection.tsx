"use client";

import Link from "next/link";
import { Anchor, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import type { PlacementDto } from "@/lib/content-model/contracts";
import { ContentStatusBadge } from "@/app/manage/content/ContentStatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { teamHref } from "../../lib/content-context";
import { placementContentOf, placementDisplayName, placementFileType, placementScopeKey } from "../../lib/placement-to-viewer";
import { contentType } from "../../lib/content-mappers";
import { ContentThumbnail } from "../../content/ContentThumbnail";
import { usePlacementStore } from "../../lib/placement-store";
import { usePlacementMap } from "./PlacementMapContext";
import { PlacementPreview } from "./PlacementPreview";
import { placementThumbnailOf } from "./placement-utils";

interface PlacementSourceSectionProps {
  placement: PlacementDto;
  actions: ReactNode;
}

/**
 * Read-only facts about the content the placement plays: the source asset or
 * scene, its saved content, and where to maintain the source.
 */
export function PlacementSourceSection({ placement, actions }: PlacementSourceSectionProps) {
  const { tx, organizationId, workspaceId } = usePlacementMap();
  const [previewOpen, setPreviewOpen] = useState(false);
  const target = placement.target;
  const scopeKey = placementScopeKey(organizationId, workspaceId);
  const detail = usePlacementStore((state) => (state.scopeKey === scopeKey && target.kind === "asset" ? state.assetDetails[target.asset_id] : undefined));
  const content = usePlacementStore((state) => placementContentOf(placement, state.placementContents, scopeKey));
  const canReadSource = target.kind === "scene" || detail?.capabilities.can_read === true;
  const type = placementFileType(placement);
  const sourceArchived = target.kind === "asset" ? target.asset_state === "archived" : target.scene_state === "archived";
  const href = target.kind === "asset"
    ? teamHref(`/manage/assets/${target.asset_id}`, organizationId)
    : teamHref(`/manage/scenes/${target.scene_id}`, organizationId);
  const sourceName = (target.kind === "asset" ? target.asset_name : target.scene_name) || tx("contentModel.integration.map.source.unnamed");
  const name = placementDisplayName(placement);
  const subtitle = `${tx(`contentModel.integration.map.type.${type}`)}${sourceName !== name ? ` · ${sourceName}` : ""}`;
  const thumbnail = <ContentThumbnail type={type === "scene" ? "scene" : contentType(type)} name={sourceName} thumbnailUrl={placementThumbnailOf(content)} textExcerpt={content?.kind === "asset" && content.payload.kind === "text" ? content.payload.text : null} className="size-10 [&_svg]:size-5" />;

  return (
    <section className="flex shrink-0 items-center gap-2 border-b p-2" aria-label={tx("contentModel.integration.map.section.source")} data-inspector-identity>
      {target.kind === "asset" ? <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogTrigger asChild><button type="button" data-thumbnail-preview className="shrink-0 overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={tx("contentModel.integration.map.source.preview")} title={tx("contentModel.integration.map.source.preview")}>{thumbnail}</button></DialogTrigger>
          <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
            <DialogHeader><DialogTitle>{sourceName}</DialogTitle></DialogHeader>
            {previewOpen && <PlacementPreview placement={placement} />}
          </DialogContent>
        </Dialog> : thumbnail}
      <div className="min-w-0 flex-1">
        <Text as="h2" variant="bodySm" fontWeight="semibold" truncate title={name}>{name}</Text>
        <div className="flex min-w-0 items-center gap-1">
          <Text as="p" variant="bodyXs" tone="subdued" truncate title={subtitle}>{subtitle}</Text>
          {sourceArchived && <ContentStatusBadge kind="archived" />}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
      {canReadSource && <>
        <Button variant="ghost" size="icon" asChild>
          <Link href={href} target="_blank" rel="noopener noreferrer" aria-label={tx(target.kind === "asset" ? "contentModel.integration.map.source.openAsset" : "contentModel.integration.map.source.openScene")} title={tx(target.kind === "asset" ? "contentModel.integration.map.source.openAsset" : "contentModel.integration.map.source.openScene")}>
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        </Button>
        {type === "anchor" && target.kind === "asset" && (
          <Button variant="ghost" size="icon" aria-label={tx("contentModel.integration.map.source.openAnchor")} title={tx("contentModel.integration.map.source.openAnchor")} onClick={() => usePlacementStore.getState().selectAnchor(target.asset_id)}>
            <Anchor className="size-4" aria-hidden />
          </Button>
        )}
      </>}
      {actions}
      </div>
    </section>
  );
}
