"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Text } from "@/components/ui/typography";
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
    <div className="min-w-0 shrink-0 px-3 pt-3 sm:px-4 lg:px-5">
      <section aria-label={label} className="flex w-fit max-w-full items-center gap-2 rounded-lg border bg-muted/30 p-2">
        <button type="button" onClick={onBrowse}
          className="flex w-28 shrink-0 flex-col items-start gap-1 rounded-md p-2 text-start hover:bg-accent focus-visible:outline-ring">
          <Text as="span" variant="bodySm" fontWeight="medium">{label}</Text>
          <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
        </button>
        <ul className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
          {items.map(scene => {
            const name = scene.name || t("contentModel.library.scene.untitled");
            return (
              <li key={scene.id} className="w-28 shrink-0 snap-start sm:w-36">
                <button type="button" onClick={onBrowse} title={name}
                  className="block w-full overflow-hidden rounded-md border bg-background text-start hover:border-foreground/25 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring">
                  <span aria-hidden className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted">
                    <TemplateCover template={scene} name={name} />
                  </span>
                  <Text as="span" variant="bodySm" truncate className="block px-2 py-1">{name}</Text>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
