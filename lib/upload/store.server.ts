import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { publicObjectUrl } from "@/lib/assets/urls";
import type { UploadPurpose, UploadResponse } from "@/lib/content-model/contracts";
import { ASSETS_PREFIX, headObject, putObject } from "@/lib/storage/oss";
import { lockObjectKeys, releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";
import { findReusableKey, issueReceipt, receiptDto } from "./receipts.server";
import type { ProcessedUploadMedia } from "./media-processing.server";
import type { UploadType } from "./types";

interface StoreScope {
  organizationId: string;
  workspaceId: string | null;
  userId: string;
  uploadType: UploadType;
  purpose: UploadPurpose;
}

function newObjectKey(userId: string, name: string): string {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return `${ASSETS_PREFIX}${userId}/${randomUUID()}${extension ? `.${extension}` : ""}`;
}

/** Final bytes, leases and their association commit together, including on reuse. */
export async function storeUploadMedia(media: ProcessedUploadMedia, scope: StoreScope): Promise<UploadResponse> {
  const files = [media, ...(media.thumbnail ? [media.thumbnail] : [])];
  const planned = await Promise.all(files.map(async (file, index) => {
    const hash = createHash("sha256").update(file.buffer).digest("hex");
    return { file, hash, uploadType: index === 0 ? scope.uploadType : "image" as const,
      existingKey: await findReusableKey(db, scope.organizationId, hash), newKey: newObjectKey(scope.userId, file.fileName) };
  }));
  const written: string[] = [];
  try {
    return await db.transaction().execute(async (trx) => {
      // Lock every possible key once, in global order. Missing reused files can
      // then safely fall back to their fresh key without acquiring more locks.
      await lockObjectKeys(trx, planned.flatMap((p) => [p.newKey, ...(p.existingKey ? [p.existingKey] : [])]));
      const receipts = [];
      for (const item of planned) {
        const reused = !!item.existingKey && !!(await headObject(item.existingKey));
        const key = reused ? item.existingKey! : item.newKey;
        if (!reused) {
          written.push(key);
          await putObject(key, item.file.buffer, { contentType: item.file.mimeType });
        }
        receipts.push(await issueReceipt(trx, { ...scope, storageKey: key, contentHash: item.hash,
          mimeType: item.file.mimeType, sizeBytes: item.file.buffer.length, uploadType: item.uploadType, reused }));
      }
      const [primary, thumbnail] = receipts;
      if (thumbnail) await trx.updateTable("upload_receipt").set({ thumbnail_receipt_id: thumbnail.id }).where("id", "=", primary.id).execute();
      return { url: publicObjectUrl(primary.storage_key), contentHash: primary.content_hash,
        storagePath: primary.reused ? null : primary.storage_key, data: receiptDto(primary) };
    });
  } catch (error) {
    // A rollback must never delete reused objects. Fresh objects use the same
    // retention protocol as every other failed upload (including delete gate).
    if (written.length) await releaseObjectsIfUnreferenced(written, { userId: scope.userId, method: "POST", path: "/api/upload" })
      .catch(() => { console.warn("Upload compensation deferred; unreferenced objects remain eligible for managed cleanup"); });
    throw error;
  }
}
