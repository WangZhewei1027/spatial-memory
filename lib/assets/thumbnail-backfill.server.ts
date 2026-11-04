import "server-only";
import { db, sql } from "@/lib/db";
import type { UploadReceiptDto } from "@/lib/content-model/contracts";
import { ContentError } from "@/lib/content-model/errors";
import { audit, contentTransaction } from "@/lib/content-model/tx.server";
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
}

export interface ThumbnailBackfillOptions {
  assetId?: string;
  organizationId?: string;
  limit?: number;
}

export type ThumbnailBackfillResult =
  | { status: "updated"; storageKey: string }
  | { status: "skipped"; reason: string };

/** Read-only inventory, including archived assets. Existing covers are never replaced. */
export async function listMissingAssetThumbnails(options: ThumbnailBackfillOptions = {}): Promise<ThumbnailBackfillCandidate[]> {
  let query = db.selectFrom("asset as a")
    .innerJoin("organization as o", "o.id", "a.organization_id")
    .leftJoin("asset_resource as p", (join) => join.onRef("p.asset_id", "=", "a.id").on("p.role", "=", "primary").on("p.ordinal", "=", 0))
    .select(["a.id", "a.name", "a.organization_id", "a.file_type", "a.state", "a.maintained_by", "a.created_by", "o.archived_at",
      "p.storage_key", "p.external_url", "p.content_hash", "p.mime_type"])
    .where("a.file_type", "in", ["model", "video"])
    .where((eb) => eb.not(eb.exists(eb.selectFrom("asset_resource as t").select("t.asset_id").whereRef("t.asset_id", "=", "a.id").where("t.role", "=", "thumbnail"))))
    .orderBy("a.id");
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
      storageKey: row.storage_key, externalUrl: row.external_url, contentHash: row.content_hash, mimeType: row.mime_type };
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
 * Trusted maintenance command, not an HTTP authorization entrypoint. It adds only
 * a derived image, including to archived assets, without changing their payload,
 * state or primary resource. The main file is rechecked after rendering so an
 * old snapshot can never be attached after a concurrent file replacement.
 */
export async function attachBackfilledThumbnail(
  candidate: ThumbnailBackfillCandidate, userId: string, receiptId: string,
): Promise<ThumbnailBackfillResult> {
  return contentTransaction(async (trx) => {
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
    if (resources.some((resource) => resource.role === "thumbnail")) return { status: "skipped", reason: "thumbnail_exists" };
    const primary = resources.find((resource) => resource.role === "primary" && resource.ordinal === 0);
    if (!primary || primary.storage_key !== candidate.storageKey || primary.external_url !== candidate.externalUrl || primary.content_hash !== candidate.contentHash)
      return { status: "skipped", reason: "primary_changed" };
    const member = await trx.selectFrom("organization_member").select("role")
      .where("organization_id", "=", candidate.organizationId).where("user_id", "=", userId).forShare().executeTakeFirst();
    if (!member || !["owner", "admin", "member"].includes(member.role)) return { status: "skipped", reason: "lease_owner_no_longer_writer" };
    const preview = await trx.selectFrom("upload_receipt").select("storage_key").where("id", "=", receiptId).executeTakeFirst();
    if (!preview) throw new ContentError("RECEIPT_INVALID", "缩略图上传回执不存在");
    await lockObjectKeys(trx, [preview.storage_key, ...(primary.storage_key ? [primary.storage_key] : [])]);
    const receipt = (await loadCommitReceipts(trx, userId, candidate.organizationId, [receiptId])).get(receiptId)!;
    if (receipt.upload_type !== "image" || !["image/png", "image/jpeg"].includes(receipt.mime_type ?? ""))
      throw new ContentError("RECEIPT_INVALID", "缩略图回执必须是图片");
    await trx.insertInto("asset_resource").values({ asset_id: candidate.id, role: "thumbnail", ordinal: 0,
      storage_key: receipt.storage_key, external_url: null, content_hash: receipt.content_hash, mime_type: receipt.mime_type, size_bytes: receipt.size_bytes }).execute();
    await trx.updateTable("asset").set((eb) => ({ lock_version: eb("lock_version", "+", 1) })).where("id", "=", candidate.id).execute();
    await markReceiptsConsumed(trx, [receiptId]);
    // Record maintenance explicitly; the lease owner did not initiate this operation.
    await audit(trx, { organizationId: candidate.organizationId, actorId: null, action: "asset.thumbnail.backfill", objectType: "asset", objectId: candidate.id,
      details: { primary_storage_key: primary.storage_key, thumbnail_storage_key: receipt.storage_key, lease_owner: userId } });
    return { status: "updated", storageKey: receipt.storage_key };
  }, "migration");
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
