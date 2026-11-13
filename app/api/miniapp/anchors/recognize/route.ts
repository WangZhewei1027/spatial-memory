import { json } from "@/lib/miniapp/request";

/** Old clients must upgrade: recognition now runs on the device, so never start paid server inference. */
export async function POST() {
  return json({ error: "图片上传识别已停用，请更新小程序后使用本机识别", code: "recognition_retired" }, 410);
}
