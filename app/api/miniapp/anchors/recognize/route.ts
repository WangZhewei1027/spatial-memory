import { json } from "@/lib/miniapp/request";

/** Old clients must upgrade: never start paid inference after the OSD migration. */
export async function POST() {
  return json({ error: "图片上传识别已停用，请更新小程序后使用本机识别", code: "recognition_retired" }, 410);
}
