import "server-only";
import busboy from "busboy";
import { createWriteStream, openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { ContentError } from "@/lib/content-model/errors";
import { getUploadSourceLimitBytes, MAX_MULTIPART_BYTES } from "./policy";

export interface UploadForm {
  form: FormData;
  /** The disk-backed File remains readable until the caller releases it. */
  dispose(): Promise<void>;
}

let activeUploads = 0;

/** Stream originals to disk; never concatenate a 512 MiB request in RAM. */
export async function readUploadForm(request: Request): Promise<UploadForm> {
  const tooLarge = () => new ContentError("VALIDATION_FAILED", "上传请求超过大小限制", undefined, 413);
  const invalid = () => new ContentError("VALIDATION_FAILED", "上传文件格式无效");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new ContentError("VALIDATION_FAILED", "需要上传 multipart/form-data 文件");
  }
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_MULTIPART_BYTES) throw tooLarge();
  if (!request.body) throw new ContentError("VALIDATION_FAILED", "缺少文件");
  if (activeUploads >= 2) throw new ContentError("VALIDATION_FAILED", "文件上传繁忙，请稍后重试", undefined, 429);
  activeUploads++;
  let directory: string | undefined, cleanup: Promise<void> | undefined;
  const dispose = () => cleanup ??= (async () => {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { activeUploads--; }
  })();
  const writes: Promise<void>[] = [];
  let parser: ReturnType<typeof busboy> | undefined;
  let parseError: Error | undefined;
  const rejectForm = (error: Error) => {
    if (parseError) return;
    parseError = error;
    // Busboy still updates its current file after emitting limit/file events.
    // Destroying it inside that callback would re-enter and clear that state.
    queueMicrotask(() => parser?.destroy(error));
  };
  try {
    directory = await mkdtemp(join(tmpdir(), `spatial-memory-upload-form-${process.pid}-`));
    const path = join(directory, "original");
    const form = new FormData();
    const maxFile = getUploadSourceLimitBytes("video");
    parser = busboy({ headers: { "content-type": contentType }, defParamCharset: "utf8", limits: {
      files: 1, fields: 8, parts: 9, fieldSize: 4096, fieldNameSize: 100,
      // Busboy flags the exact boundary as truncated; allow one extra byte
      // so a complete 512 MiB file is accepted and 512 MiB + 1 is rejected.
      fileSize: maxFile + 1,
    } });
    let fileInfo: { filename: string; mimeType: string } | undefined;
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || form.has(name)) {
        // No file pipeline owns this rejected stream; the parser pipeline
        // reports the error while the skipped stream only drains/tears down.
        stream.on("error", () => {}); stream.resume(); rejectForm(invalid()); return;
      }
      fileInfo = info;
      stream.on("limit", () => rejectForm(tooLarge()));
      const writing = pipeline(stream, createWriteStream(path, { flags: "wx", mode: 0o600 }))
        .catch(error => { parser!.destroy(error); throw error; });
      writes.push(writing);
      void writing.catch(() => {}); // pipeline below owns the eventual failure.
    });
    parser.on("field", (name, value, info) => {
      if (name === "file" || form.has(name)) { rejectForm(invalid()); return; }
      if (info.nameTruncated || info.valueTruncated) { rejectForm(tooLarge()); return; }
      form.set(name, value);
    });
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) parser.on(event, () => rejectForm(tooLarge()));
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > MAX_MULTIPART_BYTES ? tooLarge() : null, chunk);
    } });
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>), bounded, parser, { signal: request.signal });
    await Promise.all(writes);
    if (parseError) throw parseError;
    if (fileInfo) {
      const blob = await openAsBlob(path, { type: fileInfo.mimeType });
      if (blob.size > maxFile) throw tooLarge();
      form.set("file", new File([blob], fileInfo.filename, { type: fileInfo.mimeType }));
    }
    return { form, dispose };
  } catch (error) {
    parser?.destroy();
    await Promise.allSettled(writes);
    await dispose();
    if (error instanceof ContentError) throw error;
    if (error && typeof error === "object" && "code" in error && ["ENOSPC", "EACCES", "EMFILE", "EIO"].includes(String(error.code))) {
      throw new ContentError("INTERNAL", "上传暂存服务暂不可用，请稍后重试", undefined, 503);
    }
    throw invalid();
  }
}
