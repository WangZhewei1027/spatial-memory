import { recognitionCandidates, readRecognitionRequest } from "@/lib/anchor/recognition.server";
import { errorResponse, json } from "@/lib/miniapp/request";

export async function POST(request: Request) {
  try { return json(await recognitionCandidates(await readRecognitionRequest(request))); }
  catch (error) { return errorResponse(error, request, "无法获取附近识别目标"); }
}
