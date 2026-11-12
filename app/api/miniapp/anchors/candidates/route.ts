import { osdCandidates, readOSDRequest } from "@/lib/anchor/osd.server";
import { errorResponse, json } from "@/lib/miniapp/request";

export async function POST(request: Request) {
  try { return json(await osdCandidates(await readOSDRequest(request))); }
  catch (error) { return errorResponse(error, request, "无法获取附近识别目标"); }
}
