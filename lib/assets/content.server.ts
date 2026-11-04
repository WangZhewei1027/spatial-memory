import "server-only";
import type { AssetPayload, ResourceInput, ResourceRole } from "@/lib/content-model/contracts";
import { ensureAssetUse, loadOrgAccess, type Actor, type AssetIdentity, type OrgAccess } from "@/lib/content-model/access.server";
import { ContentError, invalid } from "@/lib/content-model/errors";
import type { Trx } from "@/lib/content-model/tx.server";
import { lockObjectKeys } from "@/lib/storage/retention.server";
import { loadCommitReceipts, markReceiptsConsumed } from "@/lib/upload/receipts.server";

interface ResourceRow {
  role: ResourceRole; ordinal: number; storage_key: string | null; external_url: string | null;
  content_hash: string | null; mime_type: string | null; size_bytes: number | null;
}

/** Caller holds the target asset lock. Source rows stay locked until files are committed. */
export async function writeAssetContent(
  trx: Trx, actor: Actor, asset: Pick<AssetIdentity, "id" | "organization_id">,
  payload: AssetPayload, inputs: ResourceInput[], opts: { access?: OrgAccess } = {},
): Promise<string[]> {
  const sourceIds = [...new Set(inputs.flatMap((i) => "fromAssetId" in i ? [i.fromAssetId] : []))].sort();
  let access = opts.access ?? null;
  for (const id of sourceIds) {
    if (id === asset.id) continue;
    access ??= await loadOrgAccess(trx, actor, asset.organization_id);
    if (!access?.canRead) throw new ContentError("FORBIDDEN", "无权使用来源素材的文件");
    await ensureAssetUse(trx, actor, id, access);
  }
  const sources = sourceIds.length ? await trx.selectFrom("asset_resource").selectAll().where("asset_id", "in", sourceIds).execute() : [];
  // Upload-generated covers are server-owned associations. Existing clients
  // submit only the main receipt and still commit both resources atomically.
  let effectiveInputs = inputs;
  if (payload.kind === "model" || payload.kind === "video") {
    const primary = inputs.find((i) => i.role === "primary" && (i.ordinal ?? 0) === 0);
    if (primary && "receiptId" in primary) {
      const receipt = await trx.selectFrom("upload_receipt").select("thumbnail_receipt_id").where("id", "=", primary.receiptId).executeTakeFirst();
      // A replacement cannot accidentally carry forward its previous cover,
      // even when a client resubmits the full old resource list.
      if (receipt?.thumbnail_receipt_id) effectiveInputs = [...inputs.filter((i) => i.role !== "thumbnail"), { role: "thumbnail", receiptId: receipt.thumbnail_receipt_id }];
    } else if (!inputs.some((i) => i.role === "thumbnail") && primary && "fromAssetId" in primary && primary.fromRole === "primary" && (primary.fromOrdinal ?? 0) === 0) {
      const thumbnail = sources.find((r) => r.asset_id === primary.fromAssetId && r.role === "thumbnail" && r.ordinal === 0);
      if (thumbnail) effectiveInputs = [...inputs, { role: "thumbnail", fromAssetId: primary.fromAssetId, fromRole: "thumbnail", fromOrdinal: 0 }];
    }
  }
  const receiptIds = effectiveInputs.flatMap((i) => "receiptId" in i ? [i.receiptId] : []);
  const preview = receiptIds.length ? await trx.selectFrom("upload_receipt").select("storage_key").where("id", "in", receiptIds).execute() : [];
  const previous = await trx.selectFrom("asset_resource").selectAll().where("asset_id", "=", asset.id).execute();
  await lockObjectKeys(trx, [...preview, ...sources, ...previous].flatMap((r) => r.storage_key ? [r.storage_key] : []));
  const receipts = await loadCommitReceipts(trx, actor.userId, asset.organization_id, receiptIds);
  const rows: ResourceRow[] = effectiveInputs.map((input) => {
    const base = { role: input.role, ordinal: input.ordinal ?? 0 };
    if ("receiptId" in input) {
      const r = receipts.get(input.receiptId)!;
      return { ...base, storage_key: r.storage_key, external_url: null, content_hash: r.content_hash, mime_type: r.mime_type, size_bytes: r.size_bytes };
    }
    if ("fromAssetId" in input) {
      const r = sources.find((r) => r.asset_id === input.fromAssetId && r.role === input.fromRole && r.ordinal === (input.fromOrdinal ?? 0));
      if (!r) throw invalid(`来源素材没有 ${input.fromRole}#${input.fromOrdinal ?? 0} 文件`);
      return { ...base, storage_key: r.storage_key, external_url: r.external_url, content_hash: r.content_hash, mime_type: r.mime_type, size_bytes: r.size_bytes };
    }
    return { ...base, storage_key: null, external_url: input.externalUrl, content_hash: null, mime_type: null, size_bytes: null };
  });
  const reference = (items: ResourceRow[]) => items.filter((r) => r.role === "reference" || r.role === "primary")
    .map((r) => `${r.role}|${r.ordinal}|${r.storage_key}|${r.external_url}|${r.content_hash}`).sort().join("\n");
  if (payload.kind === "anchor" && reference(previous as ResourceRow[]) !== reference(rows))
    await trx.deleteFrom("anchor_embedding").where("anchor_id", "=", asset.id).execute();
  await trx.deleteFrom("asset_resource").where("asset_id", "=", asset.id).execute();
  if (rows.length) await trx.insertInto("asset_resource").values(rows.map((r) => ({ ...r, asset_id: asset.id }))).execute();
  await trx.updateTable("asset").set({ payload: JSON.stringify(payload) }).where("id", "=", asset.id).execute();
  await markReceiptsConsumed(trx, receiptIds);
  return previous.flatMap((r) => r.storage_key ? [r.storage_key] : []);
}
