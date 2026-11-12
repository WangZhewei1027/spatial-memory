import { NextResponse } from "next/server";
import type { Updateable } from "kysely";
import { db, type DB } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { logErrorSafe } from "@/lib/log-error";
import { loadActor, requireWorkspaceEdit } from "@/lib/content-model/access.server";
import { ContentError } from "@/lib/content-model/errors";
import { errorJson } from "@/lib/content-model/http.server";
import { isUuid } from "@/lib/content-model/input";

// PATCH /api/tags/[id] - 更新标签
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 获取当前用户
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const { id: tagId } = await params;

    // 获取标签信息；修改需要标签所在项目的编辑权限
    const tag = isUuid(tagId)
      ? await db
          .selectFrom("tag")
          .select(["id", "workspace_id"])
          .where("id", "=", tagId)
          .executeTakeFirst()
      : undefined;

    if (!tag) {
      return NextResponse.json({ error: "标签不存在" }, { status: 404 });
    }
    await requireWorkspaceEdit(db, await loadActor(db, user.id), tag.workspace_id);

    // 解析请求体
    const body = await request.json();
    const { name, color } = body;

    // 构建更新对象
    const updates: Updateable<DB["tag"]> = {};
    if (name !== undefined) {
      updates.name = name.trim();
    }
    if (color !== undefined) {
      updates.color = color;
    }

    // 更新标签（没有可更新字段时不下发 UPDATE——空 SET 是非法 SQL——直接回读）
    const updatedTag =
      Object.keys(updates).length > 0
        ? await db
            .updateTable("tag")
            .set(updates)
            .where("id", "=", tagId)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await db
            .selectFrom("tag")
            .selectAll()
            .where("id", "=", tagId)
            .executeTakeFirstOrThrow();

    return NextResponse.json({ tag: updatedTag });
  } catch (error) {
    if (error instanceof ContentError) return errorJson(error);
    console.error("更新标签失败:", error);
    // 唯一约束冲突（tag_name_workspace_id_key）
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "该工作空间已存在同名标签" },
        { status: 409 }
      );
    }
    await logErrorSafe({
      method: "PATCH",
      path: "/api/tags/[id]",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

// DELETE /api/tags/[id] - 删除标签
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 获取当前用户
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const { id: tagId } = await params;

    // 获取标签信息；修改需要标签所在项目的编辑权限
    const tag = isUuid(tagId)
      ? await db
          .selectFrom("tag")
          .select(["id", "workspace_id"])
          .where("id", "=", tagId)
          .executeTakeFirst()
      : undefined;

    if (!tag) {
      return NextResponse.json({ error: "标签不存在" }, { status: 404 });
    }
    await requireWorkspaceEdit(db, await loadActor(db, user.id), tag.workspace_id);

    // 删除标签
    await db.deleteFrom("tag").where("id", "=", tagId).execute();

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ContentError) return errorJson(error);
    console.error("删除标签失败:", error);
    await logErrorSafe({
      method: "DELETE",
      path: "/api/tags/[id]",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
