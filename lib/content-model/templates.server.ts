import "server-only";
import { db, sql } from "@/lib/db";
import { publicObjectUrl, resourceUrl } from "@/lib/assets/urls";
import { lockObjectKeys, releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";
import { loadCommitReceipts, markReceiptsConsumed } from "@/lib/upload/receipts.server";
import { lockOrgForWrite, requireOrgRead, requireOrgWrite, type Actor } from "./access.server";
import { archived, checkLockVersion, invalid, notFound } from "./errors";
import { nameContainsPattern, optionalInt, rejectUnknown, requireUuid, type JsonRecord } from "./input";
import type { ManualTemplatePreview, TemplateCard, TemplateMedia, TemplateType } from "./template-contracts";
import { audit, contentTransaction, type Executor } from "./tx.server";

const PREVIEW_TARGET = { asset: "asset_id", scene: "scene_id", collection: "workspace_id" } as const;

export async function officialTemplateOrg(exec: Executor) {
  const org = await exec.selectFrom("organization").select("id")
    .where("is_official_template_library", "=", true).executeTakeFirst();
  if (!org) throw notFound("官方模板库不存在");
  return org.id;
}

function media(url: string, mime: string | null): TemplateMedia | null {
  return url ? { kind: mime === "video/mp4" ? "video" : "image", url } : null;
}

export async function listTemplates(options: { type?: TemplateType; q?: string; limit: number; offset: number }): Promise<TemplateCard[]> {
  const { rows } = await sql<Omit<TemplateCard, "thumbnail"> & { storage_key: string | null; external_url: string | null; mime_type: string | null }>`
    with official as (
      select id from organization where is_official_template_library and archived_at is null
    ), cards as (
      select a.id, 'asset' as type, a.name, coalesce(p.storage_key, r.storage_key) as storage_key,
        r.external_url, p.mime_type from asset a
      left join template_preview p on p.asset_id = a.id
      left join asset_resource r on r.asset_id = a.id and r.role = 'thumbnail' and r.ordinal = 0
      where a.organization_id in (select id from official) and a.state = 'active'
      union all
      select s.id, 'scene', s.name, p.storage_key, null, p.mime_type from scene s
      left join template_preview p on p.scene_id = s.id
      where s.organization_id in (select id from official) and s.state = 'active'
      union all
      select w.id, 'collection', w.name, p.storage_key, null, p.mime_type from workspace w
      left join template_preview p on p.workspace_id = w.id
      where w.organization_id in (select id from official) and w.archived_at is null
    )
    select * from cards where true
      ${options.type ? sql`and type = ${options.type}` : sql``}
      ${options.q ? sql`and name ilike ${nameContainsPattern(options.q)}` : sql``}
    order by name nulls last, type, id limit ${options.limit} offset ${options.offset}
  `.execute(db);
  return rows.map(({ id, type, name, ...row }) => ({ id, type, name, thumbnail: media(resourceUrl(row), row.mime_type) }));
}

async function previewTarget(exec: Executor, orgId: string, type: TemplateType, id: string, writing: boolean) {
  const query = type === "collection"
    ? exec.selectFrom("workspace").select(sql<boolean>`archived_at is not null`.as("archived")).where("organization_id", "=", orgId).where("id", "=", id)
    : exec.selectFrom(type).select(sql<boolean>`state = 'archived'`.as("archived")).where("organization_id", "=", orgId).where("id", "=", id);
  const target = await (writing ? query.forUpdate() : query).executeTakeFirst();
  if (!target) throw notFound("模板不存在");
  if (writing && target.archived) throw archived("模板已归档");
}

function previewDto(row?: { storage_key: string | null; mime_type: string | null; lock_version: number }): ManualTemplatePreview {
  return { thumbnail: row?.storage_key ? media(publicObjectUrl(row.storage_key), row.mime_type) : null, lock_version: row?.lock_version ?? 0 };
}

export async function getManualPreview(actor: Actor, type: TemplateType, id: string) {
  const orgId = await officialTemplateOrg(db);
  await requireOrgRead(db, actor, orgId);
  await previewTarget(db, orgId, type, id, false);
  const row = await db.selectFrom("template_preview").selectAll().where(PREVIEW_TARGET[type], "=", id).executeTakeFirst();
  return previewDto(row);
}

export async function setManualPreview(actor: Actor, type: TemplateType, id: string, body: JsonRecord) {
  rejectUnknown(body, ["receiptId", "expectedLockVersion"]);
  const receiptId = body.receiptId === null ? null : requireUuid(body.receiptId, "receiptId");
  const expected = optionalInt(body.expectedLockVersion, "expectedLockVersion");
  const column = PREVIEW_TARGET[type];
  const { preview, retired } = await contentTransaction(async (trx) => {
    const orgId = await officialTemplateOrg(trx);
    await requireOrgWrite(trx, actor, orgId);
    await lockOrgForWrite(trx, orgId);
    await previewTarget(trx, orgId, type, id, true);
    const current = await trx.selectFrom("template_preview").selectAll().where(column, "=", id).executeTakeFirst();
    const version = current?.lock_version ?? 0;
    checkLockVersion(expected, version, "模板封面");
    let key: string | null = null;
    let mime: string | null = null;
    if (receiptId) {
      const leased = await trx.selectFrom("upload_receipt").select("storage_key").where("id", "=", receiptId).executeTakeFirst();
      if (leased) await lockObjectKeys(trx, [leased.storage_key]);
      const receipts = await loadCommitReceipts(trx, actor.userId, orgId, [receiptId]);
      const receipt = receipts.get(receiptId)!;
      const image = receipt.upload_type === "image" && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(receipt.mime_type ?? "");
      const video = receipt.upload_type === "video" && receipt.mime_type === "video/mp4";
      if (!image && !video) throw invalid("封面需要图片、动图或视频上传回执");
      key = receipt.storage_key;
      mime = receipt.mime_type;
      await markReceiptsConsumed(trx, [receiptId]);
    }
    if ((current?.storage_key ?? null) === key) return { preview: previewDto(current), retired: null };
    const values = { storage_key: key, mime_type: mime, lock_version: version + 1 };
    await trx.insertInto("template_preview").values({ [column]: id, ...values })
      .onConflict(oc => oc.column(column).doUpdateSet(values)).execute();
    await audit(trx, { organizationId: orgId, actorId: actor.userId, action: "template.preview",
      objectType: type === "collection" ? "workspace" : type, objectId: id });
    return { preview: previewDto(values), retired: current?.storage_key };
  });
  if (retired) await releaseObjectsIfUnreferenced([retired], { userId: actor.userId, method: "PUT", path: `/api/templates/${type}/${id}/preview` });
  return preview;
}
