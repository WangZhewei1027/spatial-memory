import "server-only";
import { db } from "@/lib/db";
import { type Actor, requireOrgRead } from "@/lib/content-model/access.server";
import { archived, ContentError, forbidden, invalid, notFound } from "@/lib/content-model/errors";
import { type JsonRecord, rejectUnknown, requireUuid } from "@/lib/content-model/input";
import { hasOrgPermission } from "@/lib/permissions";
import { releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";
import { loadLockedCommitReceipt, markReceiptsConsumed } from "@/lib/upload/receipts.server";

export async function setTeamQrCenterImage(actor: Actor, orgId: string, body: JsonRecord) {
  rejectUnknown(body, ["receiptId", "expectedKey"]);
  const receiptId = body.receiptId === null ? null : requireUuid(body.receiptId, "receiptId");
  const expected = body.expectedKey;
  if (expected !== null && typeof expected !== "string") throw invalid("请提供当前二维码中心图片的 key");

  const { key, retired } = await db.transaction().execute(async (trx) => {
    const access = await requireOrgRead(trx, actor, orgId);
    if (!actor.superAdmin && !hasOrgPermission(access.orgRole, "org.settings")) throw forbidden();
    const org = await trx.selectFrom("organization").select(["wechat_qr_center_image_key", "archived_at"])
      .where("id", "=", orgId).forUpdate().executeTakeFirst();
    if (!org) throw notFound("团队不存在");
    if (org.archived_at) throw archived("团队已归档");

    let key: string | null = null;
    if (receiptId) {
      const receipt = await loadLockedCommitReceipt(trx, actor.userId, orgId, receiptId);
      if (receipt.upload_type !== "image" || !["image/jpeg", "image/png", "image/webp"].includes(receipt.mime_type ?? "")) {
        throw invalid("二维码中心图片需要图片上传回执");
      }
      key = receipt.storage_key;
      await markReceiptsConsumed(trx, [receiptId]);
    }
    const previous = org.wechat_qr_center_image_key;
    if (previous === key) return { key, retired: null };
    if (previous !== expected) throw new ContentError("LOCK_VERSION_CONFLICT", "中心图片已更新，请刷新后重试");
    await trx.updateTable("organization").set({ wechat_qr_center_image_key: key }).where("id", "=", orgId).execute();
    return { key, retired: previous };
  });
  if (retired) await releaseObjectsIfUnreferenced([retired], { userId: actor.userId, method: "PUT", path: `/api/organizations/${orgId}/wechat-qr-center-image` });
  return { key };
}
