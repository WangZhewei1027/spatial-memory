import { publicObjectUrl } from "@/lib/assets/urls";
import { requireOrgWrite, requireWorkspaceEdit, type Actor, type OrgAccess } from "@/lib/content-model/access.server";
import type { UploadPurpose, UploadReceiptDto } from "@/lib/content-model/contracts";
import { ContentError, notFound } from "@/lib/content-model/errors";
import { isUuid } from "@/lib/content-model/input";
import { toIsoRequired, type Executor, type Trx } from "@/lib/content-model/tx.server";
import { sql } from "@/lib/db";
import { UPLOAD_RECEIPT_TTL_MS } from "@/lib/storage/retention.server";
import "server-only";

/**
 * Upload receipts (plan §7): the proof that this actor put these bytes under
 * this key for this organization. Versions may only reference managed objects
 * through an unexpired receipt or an existing version of the same
 * organization, never through a bare URL. While unexpired, a receipt is also
 * the lease that keeps the collector away from an in-flight upload. The
 * collection (`workspace_id`) is optional metadata of where it was uploaded.
 */

export interface ReceiptRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  created_by: string;
  storage_key: string;
  content_hash: string;
  mime_type: string | null;
  size_bytes: number;
  upload_type: string | null;
  purpose: string;
  reused: boolean;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  thumbnail_receipt_id: string | null;
}

/** The team (and optional collection) an upload is leased to. */
export interface UploadScope {
  org: OrgAccess;
  workspaceId: string | null;
}

/**
 * Resolve `organization_id` / `workspace_id` of an upload or hash probe.
 * Both are only selectors: the organization and the caller's team role are
 * read from the database, never trusted from the request. The caller must
 * be a team writer of an open organization; a given collection must be open
 * and belong to the given organization (otherwise it looks missing).
 */
export async function resolveUploadScope(
  exec: Executor,
  actor: Actor,
  input: { organizationId: string | null; workspaceId: string | null },
): Promise<UploadScope> {
  if (input.workspaceId !== null && !isUuid(input.workspaceId)) throw notFound("合集不存在");
  if (input.organizationId !== null && !isUuid(input.organizationId)) throw notFound("组织不存在");
  let scope: UploadScope;
  if (input.workspaceId) {
    const collection = await requireWorkspaceEdit(exec, actor, input.workspaceId.toLowerCase());
    if (input.organizationId && collection.workspace.organization_id !== input.organizationId.toLowerCase())
      throw notFound("合集不存在或不属于该组织");
    scope = { org: collection, workspaceId: collection.workspace.id };
  } else if (input.organizationId) {
    scope = { org: await requireOrgWrite(exec, actor, input.organizationId.toLowerCase()), workspaceId: null };
  } else {
    throw new ContentError("VALIDATION_FAILED", "缺少 organization_id 或 workspace_id");
  }
  return scope;
}

export function receiptDto(row: ReceiptRow): UploadReceiptDto {
  return {
    id: row.id,
    organization_id: row.organization_id,
    workspace_id: row.workspace_id,
    storage_key: row.storage_key,
    url: publicObjectUrl(row.storage_key),
    content_hash: row.content_hash,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    purpose: "asset",
    reused: row.reused,
    expires_at: toIsoRequired(row.expires_at),
  };
}

export async function issueReceipt(
  trx: Trx,
  input: {
    organizationId: string;
    workspaceId: string | null;
    userId: string;
    storageKey: string;
    contentHash: string;
    mimeType: string | null;
    sizeBytes: number;
    uploadType: string | null;
    purpose: UploadPurpose;
    reused: boolean;
  },
): Promise<ReceiptRow> {
  return trx
    .insertInto("upload_receipt")
    .values({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId,
      created_by: input.userId,
      storage_key: input.storageKey,
      content_hash: input.contentHash,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      upload_type: input.uploadType,
      purpose: input.purpose,
      reused: input.reused,
      expires_at: new Date(Date.now() + UPLOAD_RECEIPT_TTL_MS),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * An existing managed object with these bytes inside the organization
 * (dedup stays organization-scoped; physical reference counting is global).
 */
export async function findReusableKey(exec: Executor, organizationId: string, contentHash: string): Promise<string | null> {
  const version = await exec
    .selectFrom("asset_resource as r")
    .innerJoin("asset as a", "a.id", "r.asset_id")
    .select("r.storage_key")
    .where("a.organization_id", "=", organizationId)
    .where("r.content_hash", "=", contentHash)
    .where("r.storage_key", "is not", null)
    .limit(1)
    .executeTakeFirst();
  if (version?.storage_key) return version.storage_key;
  const receipt = await exec
    .selectFrom("upload_receipt")
    .select("storage_key")
    .where("organization_id", "=", organizationId)
    .where("content_hash", "=", contentHash)
    .where("reused", "=", false)
    .where("expires_at", ">", sql<Date>`now()`)
    .limit(1)
    .executeTakeFirst();
  return receipt?.storage_key ?? null;
}

/**
 * Hash-only probe (`GET /api/assets/by-hash`). Knowing a hash is not proof of
 * possessing the bytes, so — unlike findReusableKey, which runs only after the
 * bytes were actually uploaded — this resolves only to files the caller can
 * already reach as a member of `org`: versions of active team assets,
 * rows in the team's collections, or the caller's own unexpired receipts.
 * Never another tenant's file or another user's uncommitted upload.
 */
export async function findProbeKey(exec: Executor, actor: Actor, org: OrgAccess, contentHash: string): Promise<string | null> {
  if (!org.canRead) return null;
  const organizationId = org.org.id;
  const version = await exec
    .selectFrom("asset_resource as r")
    .innerJoin("asset as a", "a.id", "r.asset_id")
    .select("r.storage_key")
    .where("a.organization_id", "=", organizationId)
    .where("r.content_hash", "=", contentHash)
    .where("r.storage_key", "is not", null)
    .where("a.state", "=", "active")
    .limit(1)
    .executeTakeFirst();
  if (version?.storage_key) return version.storage_key;


  const receipt = await exec
    .selectFrom("upload_receipt")
    .select("storage_key")
    .where("organization_id", "=", organizationId)
    .where("created_by", "=", actor.userId)
    .where("content_hash", "=", contentHash)
    .where("expires_at", ">", sql<Date>`clock_timestamp()`)
    .limit(1)
    .executeTakeFirst();
  return receipt?.storage_key ?? null;
}

/**
 * Receipts a version commit may use: same actor, same organization, still
 * leased. Called inside the commit transaction after the object locks.
 */
export async function loadCommitReceipts(trx: Trx, userId: string, organizationId: string, ids: string[]): Promise<Map<string, ReceiptRow>> {
  if (!ids.length) return new Map();
  const rows = await trx
    .selectFrom("upload_receipt")
    .selectAll()
    .where("id", "in", ids)
    .where("expires_at", ">", sql<Date>`clock_timestamp()`)
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new ContentError("RECEIPT_INVALID", "上传回执不存在或已过期，请重新上传");
    if (row.created_by !== userId) throw new ContentError("RECEIPT_INVALID", "上传回执不属于当前用户");
    if (row.organization_id !== organizationId) throw new ContentError("RECEIPT_INVALID", "上传回执不属于该组织");
    if (row.purpose !== "asset") throw new ContentError("RECEIPT_INVALID", "上传回执用途不匹配");
  }
  return byId;
}

export async function markReceiptsConsumed(trx: Trx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await trx.updateTable("upload_receipt").set({ consumed_at: sql<Date>`coalesce(consumed_at, now())` }).where("id", "in", ids).execute();
}
