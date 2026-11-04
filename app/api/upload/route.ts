import { loadActor } from "@/lib/content-model/access.server";
import type { UploadPurpose, UploadResponse } from "@/lib/content-model/contracts";
import { ContentError } from "@/lib/content-model/errors";
import { failure, requireSessionUserId } from "@/lib/content-model/http.server";
import { db, sql } from "@/lib/db";
import { ASSETS_PREFIX } from "@/lib/storage/oss";
import { releaseObjectsIfUnreferenced } from "@/lib/storage/retention.server";
import { resolveUploadScope } from "@/lib/upload/receipts.server";
import { storeUploadMedia } from "@/lib/upload/store.server";
import { inferUploadType } from "@/lib/upload/detection";
import { processUploadMedia } from "@/lib/upload/media-processing.server";
import { getUploadSourceLimitBytes, STORED_FILE_MAX_BYTES } from "@/lib/upload/policy";
import { readUploadForm, type UploadForm } from "@/lib/upload/request.server";
import { uploadProgressResponse } from "@/lib/upload/progress.server";
import { UPLOAD_STREAM_CONTENT_TYPE, type ServerUploadStage } from "@/lib/upload/progress";
import { ALL_UPLOAD_TYPES, type UploadType } from "@/lib/upload/types";
import { NextResponse } from "next/server";

// The browser posts originals. After authorizing the target team, the server
// normalizes audio/images/videos and stores only the processed bytes in OSS.
//
// POST multipart/form-data { file, type?, organization_id?, workspace_id?, purpose? }
//   → { url, contentHash, storagePath, data: UploadReceiptDto }
//     storagePath is null when identical bytes already exist in the target
//     organization (dedup: the existing object is reused under its object lock
//     and re-verified). The receipt binds actor, organization, key, hash and
//     purpose; it is the only way a v2 version may reference the object, and
//     while unexpired it keeps the collector away (upload lease). An upload is
//     not an asset: nothing is created or published here.
//   organization_id and workspace_id only select the team: the caller must be
//   a team writer (read from the database); a workspace_id must be an open
//   collection of that organization. No collection is needed for team
//   content. Every upload must name its team or collection.
// DELETE ?key=assets/<userId>/<name>
//   → compensation after a failed follow-up write: ends the caller's own
//     unconsumed leases on the key and hands it to the retention protocol
//     (actual deletion is deferred while object deletion is disabled).

// cacheComponents keeps route handlers on the default Node.js runtime.
export const maxDuration = 600;
const PURPOSES: readonly UploadPurpose[] = ["asset"];

function formText(form: FormData | null, name: string): string | null {
  const value = form?.get(name);
  return typeof value === "string" && value ? value : null;
}

export async function POST(request: Request) {
  let userId: string | null = null;
  let upload: UploadForm | undefined;
  let ownsUpload = true;
  try {
    userId = await requireSessionUserId();
    const actor = await loadActor(db, userId);
    upload = await readUploadForm(request);
    const { form } = upload;
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少文件" }, { status: 400 });
    }
    const requestedType = form.get("type");
    if (requestedType && (typeof requestedType !== "string" || !ALL_UPLOAD_TYPES.includes(requestedType as UploadType))) {
      return NextResponse.json({ error: "无效的文件类型" }, { status: 400 });
    }
    const inferredType = inferUploadType(file.type, file.name);
    const type = (requestedType || inferredType) as UploadType;
    // A mislabeled media file must not bypass normalization via a generic type.
    if ((inferredType === "audio" || inferredType === "image" || inferredType === "video") && type !== inferredType && !(inferredType === "image" && type === "anchor")) {
      throw new ContentError("VALIDATION_FAILED", "文件内容类型与上传类型不一致");
    }
    const sourceLimit = getUploadSourceLimitBytes(type);
    if (file.size === 0) throw new ContentError("VALIDATION_FAILED", "文件为空");
    if (file.size > sourceLimit) {
      throw new ContentError("VALIDATION_FAILED", `原始文件大小超过限制 (${sourceLimit / 1024 / 1024}MB)`, undefined, 413);
    }
    const organizationId = formText(form, "organization_id");
    const workspaceId = formText(form, "workspace_id");
    const requestedPurpose = form?.get("purpose");
    if (requestedPurpose && !PURPOSES.includes(requestedPurpose as UploadPurpose)) {
      return NextResponse.json({ error: "无效的上传用途" }, { status: 400 });
    }

    if (!organizationId && !workspaceId) throw new ContentError("VALIDATION_FAILED", "需要指定团队或地图合集");

    const scope = await resolveUploadScope(db, actor, { organizationId, workspaceId });
    const finish = async (report: (stage: ServerUploadStage) => void): Promise<UploadResponse> => {
      try {
        report(type === "image" || type === "anchor" ? "compressingImage" : type === "audio" ? "compressingAudio" : type === "video" ? "compressingVideo" : "preparing");
        const media = await processUploadMedia(file, type);
        const { buffer } = media;
        if (buffer.length === 0) throw new ContentError("VALIDATION_FAILED", "处理后的文件为空");
        if (type !== "video" && buffer.length > STORED_FILE_MAX_BYTES) {
          throw new ContentError("VALIDATION_FAILED", "处理后的文件超过 5MB 限制，请缩短音频或减小文件后重试", undefined, 413);
        }
        report("storing");
        return await storeUploadMedia(media, {
          organizationId: scope.org.org.id,
          workspaceId: scope.workspaceId,
          userId: actor.userId,
          uploadType: type,
          purpose: (requestedPurpose as UploadPurpose | null) ?? "asset",
        });
      } finally { await upload!.dispose(); }
    };
    // The async operation owns the temp file until compression/storage finish,
    // including after the streaming response has been returned.
    ownsUpload = false;
    if (request.headers.get("accept")?.includes(UPLOAD_STREAM_CONTENT_TYPE)) {
      return uploadProgressResponse(finish, error => failure(error, { method: "POST", path: "/api/upload", userId }));
    }
    return NextResponse.json(await finish(() => {}));
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/upload", userId });
  } finally {
    if (ownsUpload) await upload?.dispose();
  }
}

export async function DELETE(request: Request) {
  let userId: string | null = null;
  try {
    userId = await requireSessionUserId();
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key.startsWith(`${ASSETS_PREFIX}${userId}/`) || key.includes("..")) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }
    // End only this caller's own unconsumed leases; anyone else's lease,
    // version resource or retention hold still protects the object.
    const own = await db.selectFrom("upload_receipt").select(["id", "thumbnail_receipt_id"])
      .where("storage_key", "=", key).where("created_by", "=", userId).where("consumed_at", "is", null).execute();
    const ids = own.flatMap((receipt) => [receipt.id, ...(receipt.thumbnail_receipt_id ? [receipt.thumbnail_receipt_id] : [])]);
    const ended = ids.length ? await db.updateTable("upload_receipt").set({ expires_at: sql<Date>`now()` })
      .where("id", "in", ids).where("created_by", "=", userId).where("consumed_at", "is", null)
      .returning("storage_key").execute() : [];
    const report = await releaseObjectsIfUnreferenced([key, ...ended.map((r) => r.storage_key)], { userId, method: "DELETE", path: "/api/upload" });
    if (report.kept.length) return NextResponse.json({ removed: false, reason: "referenced" });
    if (report.candidates.length) return NextResponse.json({ removed: false, reason: "deferred" });
    if (report.failed.length) return NextResponse.json({ error: "删除失败" }, { status: 500 });
    return NextResponse.json({ removed: report.removed.length > 0 });
  } catch (error) {
    return failure(error, { method: "DELETE", path: "/api/upload", userId });
  }
}
