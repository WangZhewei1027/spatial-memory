"use server";
import { getSessionUser } from "@/lib/auth/server";
import { publicObjectUrl } from "@/lib/assets/urls";
import { db } from "@/lib/db";
import { loadActor, requireOrgRead, requireWorkspaceRead } from "@/lib/content-model/access.server";
import { getScene } from "@/lib/scene/service.server";
import { requireUuid } from "@/lib/content-model/input";
import { buildQrObjectKey, buildSceneQrObjectKey, buildWorkspaceMiniProgramPath, buildSceneMiniProgramPath, isWeChatQrEnvironment, type WeChatQrEnvironment } from "@/lib/wechat-qr";
import { getOrCreateQr } from "@/lib/wechat-qr.server";

async function actor() {
  const user = await getSessionUser();
  if (!user) throw new Error("未授权");
  return loadActor(db, user.id);
}

async function loadTeamQr(organizationId: string, key: string, path: string, environment: WeChatQrEnvironment) {
  const [url, org] = await Promise.all([
    getOrCreateQr(key, path, environment),
    db.selectFrom("organization").select("wechat_qr_center_image_key").where("id", "=", organizationId).executeTakeFirstOrThrow(),
  ]);
  return { url, centerImageUrl: org.wechat_qr_center_image_key ? publicObjectUrl(org.wechat_qr_center_image_key) : null };
}

export async function getOrCreateWorkspaceQRCode(input: { organizationId: string; workspaceId?: string | null; environment: WeChatQrEnvironment }): Promise<{ url?: string; centerImageUrl?: string | null; error?: string }> {
  try {
    const current = await actor();
    if (!isWeChatQrEnvironment(input.environment)) throw new Error("无效的小程序版本");
    const organizationId = requireUuid(input.organizationId, "organizationId");
    const workspaceId = input.workspaceId ? requireUuid(input.workspaceId, "workspaceId") : null;
    const access = await requireOrgRead(db, current, organizationId);
    if (access.org.archived_at) throw new Error("团队已归档");
    if (workspaceId) {
      const collection = await requireWorkspaceRead(db, current, workspaceId);
      if (collection.workspace.organization_id !== organizationId || collection.workspace.archived_at) throw new Error("地图合集不存在或已归档");
    }
    return await loadTeamQr(organizationId, buildQrObjectKey(organizationId, workspaceId, input.environment), buildWorkspaceMiniProgramPath(organizationId, workspaceId), input.environment);
  } catch (error) { return { error: error instanceof Error ? error.message : "二维码生成失败" }; }
}

export async function getOrCreateSceneQRCode(sceneId: string, environment: WeChatQrEnvironment): Promise<{ url?: string; centerImageUrl?: string | null; error?: string }> {
  try {
    const current = await actor();
    if (!isWeChatQrEnvironment(environment)) throw new Error("无效的小程序版本");
    const scene = await getScene(current, requireUuid(sceneId, "sceneId"));
    const access = await requireOrgRead(db, current, scene.organization_id);
    if (scene.state !== "active" || access.org.archived_at) throw new Error("场景或团队已归档");
    return await loadTeamQr(scene.organization_id, buildSceneQrObjectKey(scene.organization_id, scene.id, environment), buildSceneMiniProgramPath(scene.organization_id, scene.id), environment);
  } catch (error) { return { error: error instanceof Error ? error.message : "二维码生成失败" }; }
}
