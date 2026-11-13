import { recognitionContent, readRecognitionRequest } from "@/lib/anchor/recognition.server";
import { errorResponse, json } from "@/lib/miniapp/request";

export async function POST(request: Request) {
  try { return json(await recognitionContent(await readRecognitionRequest(request))); }
  catch (error) { return errorResponse(error, request, "无法获取目标内容"); }
}
