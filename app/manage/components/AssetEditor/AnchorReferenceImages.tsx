"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Loader2, X } from "lucide-react";
import { ContentFailureNotice } from "@/app/manage/content/ContentFeedback";
import { ContentSection } from "@/app/manage/content/ContentSection";
import type { ContentActionResult } from "@/app/manage/content/types";
import { useContentAction } from "@/app/manage/content/useContentAction";
import { acceptFor, prepareFile, uploadAssetFiles } from "@/app/manage/lib/content-upload";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { MAX_ANCHOR_REFERENCES, type AssetDetailDto, type AssetResourceDto, type ResourceInput } from "@/lib/content-model/contracts";
import { referenceImagesOf, referenceResources } from "./anchor-references";

/**
 * Recognition-target section of the asset panel: every reference image the
 * mini-program compares the camera with. A match on any image recognizes the
 * target, so add photos from other angles or lighting rather than replacing.
 */
export function AnchorReferenceImages({ asset, canEdit, onChange }: {
  asset: AssetDetailDto;
  canEdit: boolean;
  onChange: (build: (asset: AssetDetailDto) => Promise<ResourceInput[]>) => Promise<ContentActionResult>;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const action = useContentAction();
  const images = referenceImagesOf(asset);
  const room = MAX_ANCHOR_REFERENCES - images.length;

  const add = (files: File[]) => {
    if (!files.length) return;
    void action.run(() => onChange(async (current) => {
      const receipts: string[] = [];
      for (const file of files.slice(0, Math.max(0, MAX_ANCHOR_REFERENCES - referenceImagesOf(current).length))) {
        const uploaded = await uploadAssetFiles(await prepareFile(file, "anchor"), { organizationId: current.organization_id });
        receipts.push(...uploaded.receipts.map((receipt) => receipt.id));
      }
      return referenceResources(current, referenceImagesOf(current), receipts);
    }));
  };
  const remove = (target: AssetResourceDto) => {
    void action.run(() => onChange(async (current) => referenceResources(
      current,
      referenceImagesOf(current).filter((resource) => !(resource.role === target.role && resource.ordinal === target.ordinal)),
      [],
    )));
  };

  return (
    <ContentSection
      plain
      title={t("matching.referenceImages", { count: images.length, max: MAX_ANCHOR_REFERENCES })}
      description={t("matching.imageHint")}
    >
      <div className="space-y-2 pb-1">
        <ul className="grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <li key={`${image.role}:${image.ordinal}`} className="relative aspect-square overflow-hidden rounded-md bg-muted">
              {/* Reference photos have arbitrary sizes and come straight from the media host. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={t("matching.referenceImageAlt", { index: index + 1 })} className="size-full object-cover" />
              {canEdit && images.length > 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute end-1 top-1 size-7"
                  aria-label={t("matching.removeImage", { index: index + 1 })}
                  disabled={action.pending}
                  onClick={() => remove(image)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept={acceptFor("anchor")}
              onChange={(event) => {
                add(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={action.pending || room <= 0} onClick={() => input.current?.click()}>
                {action.pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                {action.pending ? t("matching.saving") : t("matching.addImages")}
              </Button>
              {room <= 0 && <Text as="span" variant="bodyXs" tone="subdued">{t("matching.maxImages", { max: MAX_ANCHOR_REFERENCES })}</Text>}
            </div>
          </>
        )}
        {action.failure && <ContentFailureNotice failure={action.failure} />}
      </div>
    </ContentSection>
  );
}
