"use client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { MODEL_DRAG_TYPE } from "@/lib/scene/editor-interactions";
import { Box, ImageIcon, Music2, Film, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useIntegrationText } from "../../lib/integration-text";
import { SCENE_LIBRARY_TEXTS } from "./scene-library-texts";
import { libraryDuration, type LibraryLayout } from "./scene-library";
import type { SceneResource } from "./types";

function LibraryArtwork({ resource }: { resource: SceneResource }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const kind = resource.kind ?? "model";
  const Icon = { model: Box, image: ImageIcon, video: Film, audio: Music2 }[kind];
  const url = resource.thumbnailUrl || (kind === "image" ? resource.url : null);
  return <div className="scene-library-artwork" data-kind={kind}>
    {url && failedUrl !== url
      // User media URLs already point to optimized files; browsing must not decode GLB/video sources.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedUrl(url)} />
      : <Icon aria-hidden="true" />}
  </div>;
}

export interface SceneLibraryListProps {
  entries: SceneResource[]; layout: LibraryLayout;
  canAdd: boolean; loading: boolean;
  onRegister: (resource: SceneResource) => void; onAdd: (resource: SceneResource) => void;
}
export function SceneLibraryList(props: SceneLibraryListProps) {
  const tx = useIntegrationText(SCENE_LIBRARY_TEXTS);
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const labels = { model: zh ? "3D 模型" : "3D model", image: zh ? "图片" : "Image", audio: zh ? "音频" : "Audio", video: zh ? "视频" : "Video" };
  return <div className="scene-library-items" data-layout={props.layout} aria-busy={props.loading}>
    {props.loading && <div role="status" className="scene-library-loading"><span className="sr-only">{tx("contentModel.integration.sceneLibrary.loading")}</span>{[0, 1, 2, 3].map(key => <div key={key}><Skeleton className="scene-library-artwork" /><Skeleton className="mt-2 h-4 w-3/4" /></div>)}</div>}
    {props.entries.map(resource => {
      const name = resource.name || resource.assetId;
      const kind = resource.kind ?? "model";
      const available = !!resource.url && !!resource.assetId && resource.assetState !== "archived";
      const draggable = props.canAdd && available;
      const duration = libraryDuration(resource.durationSeconds);
      const problem = !resource.url ? tx("contentModel.integration.sceneLibrary.missing") : resource.assetState === "archived" ? (zh ? "已归档" : "Archived") : null;
      const nameLabel = <Text as="span" variant="bodyXs" fontWeight="medium" truncate className="scene-library-name" title={name}>{name}</Text>;
      return <div key={resource.assetId} className="scene-library-item" data-unavailable={!available || undefined} draggable={draggable} title={problem || tx("contentModel.integration.sceneLibrary.drag")} onDoubleClick={() => { if (draggable) props.onAdd(resource); }} onDragStart={event => {
        if (!draggable || (event.target as HTMLElement).closest("button")) { event.preventDefault(); return; }
        props.onRegister(resource); event.dataTransfer.setData(MODEL_DRAG_TYPE, resource.assetId); event.dataTransfer.effectAllowed = "copy";
      }}>
        <div className="scene-library-artwork-wrap">
          <LibraryArtwork resource={resource} />
          {duration && <span className="scene-library-duration">{duration}</span>}
        </div>
        <div className="scene-library-item-info">
          {nameLabel}
          <Text as="span" variant="bodyXs" tone={problem ? "critical" : "subdued"} className="scene-library-item-detail">{problem || labels[kind]}{props.layout === "list" && duration ? ` · ${duration}` : ""}</Text>
        </div>
        <Button variant="secondary" size="icon" className="scene-library-add" draggable={false} disabled={!draggable} aria-label={tx("contentModel.integration.sceneLibrary.add", { name })} title={tx("contentModel.integration.sceneLibrary.add", { name })} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); props.onAdd(resource); }}><Plus /></Button>
      </div>;
    })}
  </div>;
}
