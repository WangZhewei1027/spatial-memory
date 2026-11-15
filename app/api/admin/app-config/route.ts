import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/server";
import { getUserContext } from "@/lib/permissions.server";
import { isSuperAdmin } from "@/lib/permissions";
import { logErrorSafe } from "@/lib/log-error";
import { ALL_UPLOAD_TYPES } from "@/lib/upload/types";

// 全局应用配置（app_config 表，仅 super_admin 可读写）。
// 数据库连接拥有全部权限、没有 RLS 兜底，所以访问前必须先做严格权限检查。
// 目前唯一的键：default_allowed_file_types —— 新建组织时写入的默认文件类型。

const CONFIG_KEYS = ["default_allowed_file_types"] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

function validateValue(key: ConfigKey, value: unknown): string | null {
  if (key === "default_allowed_file_types") {
    const valid =
      Array.isArray(value) &&
      value.every((t) => (ALL_UPLOAD_TYPES as string[]).includes(t));
    if (!valid) return "无效的文件类型配置";
  }
  return null;
}

async function requireSuperAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: "未授权", status: 401, userId: null };

  const { globalRole } = await getUserContext(user.id);

  if (!isSuperAdmin(globalRole)) {
    return { error: "权限不足", status: 403, userId: user.id };
  }
  return { error: null, status: 200, userId: user.id };
}

export async function GET() {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const rows = await db
      .selectFrom("app_config")
      .select(["key", "value"])
      .where("key", "in", [...CONFIG_KEYS])
      .execute();

    const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return NextResponse.json({ data: config });
  } catch (error) {
    console.error("获取应用配置失败:", error);
    await logErrorSafe({
      method: "GET",
      path: "/api/admin/app-config",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "获取应用配置失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireSuperAdmin();
    if (auth.error) {
      await logErrorSafe({
        userId: auth.userId ?? undefined,
        method: "PUT",
        path: "/api/admin/app-config",
        status: auth.status,
        message: `应用配置更新被拒: ${auth.error}`,
      });
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { key, value } = body as { key?: string; value?: unknown };

    if (!key || !(CONFIG_KEYS as readonly string[]).includes(key)) {
      return NextResponse.json({ error: "无效的配置键" }, { status: 400 });
    }

    const validationError = validateValue(key as ConfigKey, value);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // jsonb 列：写入时序列化成字符串，读回来已是解析后的值
    const serialized = JSON.stringify(value);
    const updatedAt = new Date().toISOString();
    const data = await db
      .insertInto("app_config")
      .values({ key, value: serialized, updated_at: updatedAt })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({ value: serialized, updated_at: updatedAt }),
      )
      .returning(["key", "value"])
      .executeTakeFirstOrThrow();

    return NextResponse.json({ data });
  } catch (error) {
    console.error("更新应用配置失败:", error);
    await logErrorSafe({
      method: "PUT",
      path: "/api/admin/app-config",
      status: 500,
      error,
    });
    return NextResponse.json({ error: "更新应用配置失败" }, { status: 500 });
  }
}
