"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Text } from "@/components/ui/typography";
import { VideoPreviewTooltip } from "@/components/ui/video-preview-tooltip";
import { templateApi } from "../lib/content-api";
import { subscribeContentChanges } from "../lib/content-events";
import { TemplateCover } from "./TemplateCover";
import { useLibraryPages } from "./useLibraryPages";

const loadScenes = (offset: number, limit: number, signal: AbortSignal) =>
  templateApi.list("scene", "", offset, limit, signal);

export function PublicSceneStrip({ onBrowse }: { onBrowse: () => void }) {
  const { t } = useTranslation();
  const { items, refresh } = useLibraryPages(loadScenes, 10);
  useEffect(() => subscribeContentChanges(refresh), [refresh]);
  if (!items.length) return null;

  const label = t("contentModel.library.scene.browsePublic");
  return (
    <section aria-label={label} className="flex min-w-0 shrink-0 items-center gap-4 px-3 pt-3 sm:px-4 lg:px-5">
      <button type="button" onClick={onBrowse}
        className="flex min-h-11 max-w-28 shrink-0 items-center gap-1.5 rounded-sm text-start underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-ring sm:max-w-none">
        <Text as="span" variant="bodySm" fontWeight="medium">{label}</Text>
        <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <ul className="flex min-w-0 snap-x gap-3 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
        {items.map(scene => {
          const name = scene.name || t("contentModel.library.scene.untitled");
          const videoUrl = scene.thumbnail?.kind === "video" ? scene.thumbnail.url : undefined;
          return (
            <li key={scene.id} className="w-28 shrink-0 snap-start sm:w-36">
              <VideoPreviewTooltip src={videoUrl} name={name}>
                <button type="button" onClick={onBrowse} title={videoUrl ? undefined : name}
                  className="block w-full rounded-md text-start underline-offset-4 hover:underline focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring">
                  <span aria-hidden className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-muted">
                    <TemplateCover template={scene} name={name} />
                  </span>
                  <Text as="span" variant="bodySm" truncate className="mt-1 block">{name}</Text>
                </button>
              </VideoPreviewTooltip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
