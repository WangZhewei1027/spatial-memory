import { osdContent, readOSDRequest } from "@/lib/anchor/osd.server";
import { errorResponse, json } from "@/lib/miniapp/request";

export async function POST(request: Request) {
  try { return json(await osdContent(await readOSDRequest(request))); }
  catch (error) { return errorResponse(error, "无法获取目标内容"); }
}
