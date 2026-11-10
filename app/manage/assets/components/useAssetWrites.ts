"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssetDetailDto, ResourceInput } from "@/lib/content-model/contracts";
import type { AssetContentInput, ContentActionResult } from "@/app/manage/content";
import { assetApi, isLockConflict } from "@/app/manage/lib/content-api";
import { impactLines, runContentAction } from "@/app/manage/lib/content-errors";
import type { IntegrationT } from "@/app/manage/lib/integration-text";
import { bodyForIntent, contentSignature, intentFor, settleFailure, type UploadIntent, type AssetInputContent } from "./asset-upload";
import { isFileType, type CreatableType } from "./AssetContentField";
import type { useAssetDetail } from "./useAssetDetail";

type Detail = ReturnType<typeof useAssetDetail>;

function assetContent(asset: AssetDetailDto, input: AssetContentInput): AssetInputContent | null {
  const type = asset.file_type as CreatableType;
  if (input.file) return isFileType(type) ? { kind: "file", type, file: input.file } : null;
  if (asset.file_type === "text" && input.text !== undefined) return { kind: "text", text: input.text };
  if (asset.file_type === "link" && input.url !== undefined) return { kind: "link", url: input.url };
  return null;
}

/**
 * Every write sends the latest lock, applies the returned identity row and
 * reloads detail + usage. A stale lock marks the page stale instead of retrying.
 */
export function useAssetWrites(detail: Detail, tx: IntegrationT) {
  const { t } = useTranslation();
  const [stale, setStale] = useState(false);
  const [archiveImpact, setArchiveImpact] = useState<string[] | null>(null);
  const editIntent = useRef<UploadIntent | null>(null);
  const asset = detail.asset;

  const write = <T,>(action: (lock: number) => Promise<T>, after?: (value: T) => void): Promise<ContentActionResult> =>
    runContentAction(
      async () => {
        try {
          return await action(detail.lockVersion());
        } catch (error) {
          if (isLockConflict(error)) setStale(true);
          throw error;
        }
      },
      tx,
      async (value) => {
        after?.(value);
        await detail.refresh();
      },
    );
  const failed = (message?: string): ContentActionResult => ({ ok: false, kind: "error", message });

  const editContent = async (input: AssetContentInput): Promise<ContentActionResult> => {
    if (!asset) return failed();
    const content = assetContent(asset, input);
    if (!content) return failed();
    // Updated files upload into the asset's team; no collection is involved.
    const current = intentFor(editIntent, [asset.organization_id, contentSignature(content)].join("|"));
    return write(
      async (lock) => {
        try {
          const body = await bodyForIntent(current, content, asset.organization_id, (key) => String(t(key)), input.onStage);
          input.onStage?.("creating");
          return await assetApi.update(asset.id, {
            payload: body.payload,
            resources: body.resources,
            expectedLockVersion: lock,
          });
        } catch (error) {
          settleFailure(editIntent, error);
          throw error;
        }
      },
      (result) => {
        editIntent.current = null;
        detail.applyAsset(result);
      },
    );
  };

  const onAsset = (run: (assetId: string) => Promise<ContentActionResult>) => (asset ? run(asset.id) : Promise.resolve(failed()));
  const update = (fields: { name?: string; state?: "active" }) =>
    onAsset((assetId) => write((lock) => assetApi.update(assetId, { expectedLockVersion: lock, ...fields }), detail.applyAsset));

  return {
    stale,
    archiveImpact,
    dismissArchiveImpact: () => setArchiveImpact(null),
    reload: async () => {
      setStale(false);
      await detail.refresh();
    },
    editContent,
    /**
     * Rewrite the resource list while keeping the payload, e.g. a recognition
     * target's reference images. `build` runs inside the write, after the lock
     * is read, so uploads it performs fail the action like any other error.
     */
    editResources: (build: (asset: AssetDetailDto) => Promise<ResourceInput[]>) => {
      if (!asset) return Promise.resolve(failed());
      return write(async (lock) => assetApi.update(asset.id, { payload: asset.payload, resources: await build(asset), expectedLockVersion: lock }), detail.applyAsset);
    },
    rename: (name: string) => update({ name }),
    restore: async () => {
      const result = await update({ state: "active" });
      if (result.ok) setArchiveImpact(null);
      return result;
    },
    archive: () =>
      onAsset((assetId) =>
        write((lock) => assetApi.archive(assetId, lock), (result) => {
          detail.applyAsset(result.asset);
          setArchiveImpact(impactLines(result.impact, tx));
        }),
      ),
  };
}
