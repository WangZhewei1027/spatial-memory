import "server-only";
import { db, sql } from "@/lib/db";
import type { UploadReceiptDto } from "@/lib/content-model/contracts";
import { ContentError } from "@/lib/content-model/errors";
import { audit, contentTransaction, type Executor } from "@/lib/content-model/tx.server";
import { logError } from "@/lib/log-error";
import { getObject, headObject } from "@/lib/storage/oss";
import { lockObjectKeys, releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";
import { generateModelThumbnail } from "@/lib/upload/model-thumbnail.server";
import { generateVideoThumbnail } from "@/lib/upload/media-processing.server";
import { getUploadSourceLimitBytes } from "@/lib/upload/policy";
import { loadCommitReceipts, markReceiptsConsumed } from "@/lib/upload/receipts.server";
import { storeUploadMedia } from "@/lib/upload/store.server";

export interface ThumbnailBackfillCandidate {
  id: string;
  name: string | null;
  organizationId: string;
  organizationArchived: boolean;
  type: "model" | "video";
  state: string;
  maintainedBy: string | null;
  createdBy: string | null;
  storageKey: string | null;
  externalUrl: string | null;
  contentHash: string | null;
  mimeType: string | null;
  previousThumbnail: { ordinal: 0; storageKey: string; externalUrl: string | null; contentHash: string | null } | null;
}

export interface ThumbnailBackfillOptions {
  assetId?: string;
  organizationId?: string;
  limit?: number;
  regenerateModels?: boolean;
}

export type ThumbnailBackfillResult =
  | { status: "updated"; storageKey: string; previousStorageKey?: string }
  | { status: "unchanged"; storageKey: string }
  | { status: "skipped"; reason: string };

/** Missing covers by default. Refresh requires proof the exact current pair was generated. */
export async function listAssetThumbnailCandidates(options: ThumbnailBackfillOptions = {}, exec: Executor = db): Promise<ThumbnailBackfillCandidate[]> {
  let query = exec.selectFrom("asset as a")
    .innerJoin("organization as o", "o.id", "a.organization_id")
    .leftJoin("asset_resource as p", (join) => join.onRef("p.asset_id", "=", "a.id").on("p.role", "=", "primary").on("p.ordinal", "=", 0))
    .leftJoin("asset_resource as t", (join) => join.onRef("t.asset_id", "=", "a.id").on("t.role", "=", "thumbnail").on("t.ordinal", "=", 0))
    .select(["a.id", "a.name", "a.organization_id", "a.file_type", "a.state", "a.maintained_by", "a.created_by", "o.archived_at",
      "p.storage_key", "p.external_url", "p.content_hash", "p.mime_type", "t.storage_key as thumbnail_key",
      "t.content_hash as thumbnail_hash", "t.external_url as thumbnail_external_url"])
    .orderBy("a.id");
  if (options.regenerateModels) {
    query = query.where("a.file_type", "=", "model").where("p.storage_key", "is not", null).where("t.storage_key", "is not", null)
      .where((eb) => eb.or([
        eb.exists(eb.selectFrom("content_audit_log as log").select("log.id")
          .whereRef("log.organization_id", "=", "a.organization_id").where("log.object_type", "=", "asset").whereRef("log.object_id", "=", "a.id")
          .where("log.action", "in", ["asset.thumbnail.backfill", "asset.thumbnail.regenerate"])
          .where(sql<boolean>`log.details->>'primary_storage_key' = p.storage_key and log.details->>'thumbnail_storage_key' = t.storage_key`)),
        eb.exists(eb.selectFrom("upload_receipt as model").innerJoin("upload_receipt as image", "image.id", "model.thumbnail_receipt_id").select("model.id")
          .whereRef("model.organization_id", "=", "a.organization_id").whereRef("image.organization_id", "=", "a.organization_id")
          .where("model.upload_type", "=", "model").where("image.upload_type", "=", "image")
          .whereRef("model.storage_key", "=", "p.storage_key").whereRef("image.storage_key", "=", "t.storage_key")),
      ]));
  } else {
    query = query.where("a.file_type", "in", ["model", "video"])
      .where((eb) => eb.not(eb.exists(eb.selectFrom("asset_resource as existing").select("existing.asset_id")
        .whereRef("existing.asset_id", "=", "a.id").where("existing.role", "=", "thumbnail"))));
  }
  if (options.assetId) query = query.where("a.id", "=", options.assetId);
  if (options.organizationId) query = query.where("a.organization_id", "=", options.organizationId);
  if (options.limit !== undefined) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error("limit must be a positive integer");
    query = query.limit(options.limit);
  }
  const rows = await query.execute();
  return rows.map((row) => {
    if (row.file_type !== "model" && row.file_type !== "video") throw new Error("Unexpected asset type");
    return { id: row.id, name: row.name, organizationId: row.organization_id, organizationArchived: row.archived_at !== null,
      type: row.file_type, state: row.state, maintainedBy: row.maintained_by, createdBy: row.created_by,
      storageKey: row.storage_key, externalUrl: row.external_url, contentHash: row.content_hash, mimeType: row.mime_type,
      previousThumbnail: row.thumbnail_key ? { ordinal: 0, storageKey: row.thumbnail_key, externalUrl: row.thumbnail_external_url, contentHash: row.thumbnail_hash } : null };
  });
}

/** A migration lease needs a current team writer, even when the original uploader has left. */
async function leaseOwner(candidate: ThumbnailBackfillCandidate): Promise<string | null> {
  const member = await db.selectFrom("organization_member").select("user_id")
    .where("organization_id", "=", candidate.organizationId).where("role", "in", ["owner", "admin", "member"])
    .orderBy(sql<number>`case when user_id = ${candidate.maintainedBy} then 0 when user_id = ${candidate.createdBy} then 1 when role = 'owner' then 2 else 3 end`)
    .orderBy("user_id").executeTakeFirst();
  return member?.user_id ?? null;
}

/**
 * Trusted maintenance command. The asset lock serializes attachment with normal
 * writers. Refresh additionally checks the previous cover and its provenance
 * before swapping the generated image.
 */
export async function attachBackfilledThumbnail(
  candidate: ThumbnailBackfillCandidate, userId: string, receiptId: string,
): Promise<ThumbnailBackfillResult> {
  const result = await contentTransaction<ThumbnailBackfillResult>(async (trx) => {
    // Match content writers' organization → asset → object lock ordering.
    const organization = await trx.selectFrom("organization").select(["id", "archived_at"])
      .where("id", "=", candidate.organizationId).forShare().executeTakeFirst();
    if (!organization) return { status: "skipped", reason: "organization_deleted" };
    if (organization.archived_at) return { status: "skipped", reason: "organization_archived" };
    const asset = await trx.selectFrom("asset").select(["id", "organization_id", "file_type"])
      .where("id", "=", candidate.id).forUpdate().executeTakeFirst();
    if (!asset) return { status: "skipped", reason: "asset_deleted" };
    if (asset.organization_id !== candidate.organizationId || asset.file_type !== candidate.type)
      return { status: "skipped", reason: "asset_changed" };
    const resources = await trx.selectFrom("asset_resource").selectAll().where("asset_id", "=", candidate.id).execute();
    const previous = candidate.previousThumbnail;
    const currentCover = resources.find((resource) => resource.role === "thumbnail" && resource.ordinal === 0);
    if (!previous && resources.some((resource) => resource.role === "thumbnail")) return { status: "skipped", reason: "thumbnail_exists" };
    if (previous && (!currentCover || currentCover.storage_key !== previous.storageKey || currentCover.content_hash !== previous.contentHash
      || currentCover.external_url !== previous.externalUrl || currentCover.ordinal !== previous.ordinal))
      return { status: "skipped", reason: "thumbnail_changed" };
    const primary = resources.find((resource) => resource.role === "primary" && resource.ordinal === 0);
    if (!primary || primary.storage_key !== candidate.storageKey || primary.external_url !== candidate.externalUrl || primary.content_hash !== candidate.contentHash)
      return { status: "skipped", reason: "primary_changed" };
    const member = await trx.selectFrom("organization_member").select("role")
      .where("organization_id", "=", candidate.organizationId).where("user_id", "=", userId).forShare().executeTakeFirst();
    if (!member || !["owner", "admin", "member"].includes(member.role)) return { status: "skipped", reason: "lease_owner_no_longer_writer" };
    const preview = await trx.selectFrom("upload_receipt").select("storage_key").where("id", "=", receiptId).executeTakeFirst();
    if (!preview) throw new ContentError("RECEIPT_INVALID", "缩略图上传回执不存在");
    await lockObjectKeys(trx, [preview.storage_key, ...(primary.storage_key ? [primary.storage_key] : []), ...(previous ? [previous.storageKey] : [])]);
    if (previous && !(await listAssetThumbnailCandidates({ assetId: asset.id, regenerateModels: true }, trx)).length)
      return { status: "skipped", reason: "thumbnail_origin_unverified" };
    const receipt = (await loadCommitReceipts(trx, userId, candidate.organizationId, [receiptId])).get(receiptId)!;
    if (receipt.upload_type !== "image" || !["image/png", "image/jpeg"].includes(receipt.mime_type ?? ""))
      throw new ContentError("RECEIPT_INVALID", "缩略图回执必须是图片");
    if (previous && (previous.storageKey === receipt.storage_key || previous.contentHash === receipt.content_hash))
      return { status: "unchanged", storageKey: previous.storageKey };
    const image = { storage_key: receipt.storage_key, external_url: null, content_hash: receipt.content_hash, mime_type: receipt.mime_type, size_bytes: receipt.size_bytes };
    if (previous) {
      await trx.updateTable("asset_resource").set(image)
        .where("asset_id", "=", candidate.id).where("role", "=", "thumbnail").where("ordinal", "=", previous.ordinal).executeTakeFirstOrThrow();
    } else {
      await trx.insertInto("asset_resource").values({ ...image, asset_id: candidate.id, role: "thumbnail", ordinal: 0 }).execute();
    }
    await trx.updateTable("asset").set((eb) => ({ lock_version: eb("lock_version", "+", 1) })).where("id", "=", candidate.id).execute();
    await markReceiptsConsumed(trx, [receiptId]);
    // Record maintenance explicitly; the lease owner did not initiate this operation.
    await audit(trx, { organizationId: candidate.organizationId, actorId: null, action: previous ? "asset.thumbnail.regenerate" : "asset.thumbnail.backfill",
      objectType: "asset", objectId: candidate.id, details: { primary_storage_key: primary.storage_key, thumbnail_storage_key: receipt.storage_key,
        lease_owner: userId, ...(previous ? { previous_thumbnail_storage_key: previous.storageKey } : {}) } });
    return { status: "updated", storageKey: receipt.storage_key, ...(previous ? { previousStorageKey: previous.storageKey } : {}) };
  }, "migration");
  if (result.status === "updated" && result.previousStorageKey) {
    const context = { userId, method: "BACKFILL", path: "asset-thumbnails" };
    await releaseObjectsIfUnreferenced([result.previousStorageKey], context).catch(() => logError({
      ...context, status: 500, message: "Deferred retention check for replaced model thumbnail",
      context: { assetId: candidate.id, storageKey: result.previousStorageKey },
    }));
  }
  return result;
}

async function abandonReceipt(receipt: UploadReceiptDto, userId: string): Promise<void> {
  await db.updateTable("upload_receipt").set({ expires_at: sql<Date>`now()` })
    .where("id", "=", receipt.id).where("created_by", "=", userId).where("consumed_at", "is", null).execute();
  await releaseObjectsIfUnreferenced([receipt.storage_key], { userId, method: "BACKFILL", path: "asset-thumbnails" });
}

/** Sequential caller limits historical rendering pressure to one asset at a time. */
export async function backfillAssetThumbnail(candidate: ThumbnailBackfillCandidate): Promise<ThumbnailBackfillResult> {
  if (candidate.organizationArchived) return { status: "skipped", reason: "organization_archived" };
  if (!candidate.storageKey) return { status: "skipped", reason: candidate.externalUrl ? "external_url_requires_import" : "primary_missing" };
  const userId = await leaseOwner(candidate);
  if (!userId) return { status: "skipped", reason: "team_has_no_writer" };
  const object = await headObject(candidate.storageKey);
  if (!object) return { status: "skipped", reason: "primary_object_missing" };
  const limit = getUploadSourceLimitBytes(candidate.type);
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > limit)
    return { status: "skipped", reason: "primary_size_out_of_bounds" };
  const buffer = await getObject(candidate.storageKey);
  if (buffer.length !== object.size || buffer.length > limit) throw new Error("Primary object changed while reading");
  const thumbnail = candidate.type === "model"
    ? await generateModelThumbnail(buffer)
    : await generateVideoThumbnail(new File([new Uint8Array(buffer)], "source-video", { type: candidate.mimeType ?? "video/mp4" }));
  const extension = candidate.type === "model" ? "png" : "jpg";
  const uploaded = await storeUploadMedia({ buffer: thumbnail, fileName: `${candidate.id}.thumbnail.${extension}`,
    mimeType: candidate.type === "model" ? "image/png" : "image/jpeg" },
  { organizationId: candidate.organizationId, workspaceId: null, userId, uploadType: "image", purpose: "asset" });
  let attached = false;
  try {
    const result = await attachBackfilledThumbnail(candidate, userId, uploaded.data.id);
    attached = result.status === "updated";
    return result;
  } finally {
    if (!attached) await abandonReceipt(uploaded.data, userId);
  }
}
