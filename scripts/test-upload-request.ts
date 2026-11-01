import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import nextConfig from "../next.config";
import { ContentError } from "../lib/content-model/errors";
import { inferUploadType } from "../lib/upload/detection";
import { getUploadSourceLimitBytes, MAX_MULTIPART_BYTES, STORED_FILE_MAX_BYTES } from "../lib/upload/policy";
import { readUploadForm } from "../lib/upload/request.server";

const MIB = 1024 * 1024;
const boundary = "upload-request-regression-boundary";
const headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
const fileHeader = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="original.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
const ending = new TextEncoder().encode(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="organization_id"\r\n\r\nteam\r\n--${boundary}--\r\n`);
const rejectsStatus = (status: number) => (error: unknown) => error instanceof ContentError && error.status === status;
const stagedDirectories = async () => (await readdir(tmpdir())).filter(name => name.startsWith(`spatial-memory-upload-form-${process.pid}-`)).sort();
function smallRequest() {
  const body = new FormData();
  body.set("file", new File([new Uint8Array([1, 2, 3])], "输入.wav", { type: "audio/wav" }));
  body.set("organization_id", "team");
  return new Request("http://localhost/api/upload", { method: "POST", body });
}
function streamRequest(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers, body, duplex: "half", signal };
  return new Request("http://localhost/api/upload", init);
}
async function encodedFormRequest(form: FormData) {
  // Tiny malformed fixtures are pre-encoded to model received HTTP bytes.
  // Cancelling Node's in-process FormData producer can otherwise race its
  // Blob encoder after the consumer has already rejected the malformed part.
  const encoded = new Response(form);
  return new Request("http://localhost/api/upload", { method: "POST", headers: encoded.headers, body: await encoded.arrayBuffer() });
}
/** Reuses one 1 MiB chunk; even a 512 MiB request never exists as one JS buffer. */
function lazyMultipart(size: number, stallAfterFile = false) {
  const chunk = new Uint8Array(MIB).fill(7);
  let phase = 0, remaining = size, cancelled = false, chunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      if (phase === 0) { phase++; controller.enqueue(fileHeader); return; }
      if (remaining > 0) {
        const length = Math.min(remaining, chunk.length);
        remaining -= length;
        if (remaining === 0) {
          const last = chunk.slice(0, length); last[last.length - 1] = 123; controller.enqueue(last);
        } else controller.enqueue(chunk);
        return;
      }
      if (phase === 1) {
        if (stallAfterFile) return new Promise<void>(() => {});
        phase++; controller.enqueue(ending); return;
      }
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  return { body, get cancelled() { return cancelled; }, get chunks() { return chunks; } };
}

test("original media size policy is independent of the stored output limit", () => {
  for (const type of ["image", "anchor", "audio"] as const) assert.equal(getUploadSourceLimitBytes(type), 32 * MIB);
  assert.equal(getUploadSourceLimitBytes("model"), 5 * MIB);
  assert.equal(getUploadSourceLimitBytes("video"), 512 * MIB);
  assert.equal(MAX_MULTIPART_BYTES, 513 * MIB);
  assert.equal(STORED_FILE_MAX_BYTES, 5 * MIB);
  for (const extension of ["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "aiff", "aif", "amr", "wma"]) {
    assert.equal(inferUploadType("application/octet-stream", `sound.${extension}`), "audio");
  }
  assert.equal(inferUploadType("audio/webm", "recording.webm"), "audio");
  assert.equal(inferUploadType("application/octet-stream", "movie.webm"), "video");
});

test("multipart files preserve bytes/name/type on disk until idempotent disposal", async () => {
  const before = await stagedDirectories();
  const parsed = await readUploadForm(smallRequest());
  try {
    const file = parsed.form.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "输入.wav"); assert.equal(file.type, "audio/wav");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal(parsed.form.get("organization_id"), "team");
    assert.equal((await stagedDirectories()).length, before.length + 1);
    await parsed.dispose(); await parsed.dispose();
    assert.deepEqual(await stagedDirectories(), before);
    await assert.rejects(file.arrayBuffer(), "a released disk-backed upload cannot retain its original bytes in memory");
  } finally { await parsed.dispose(); }
});

test("malformed, truncated, duplicate and oversized multipart parts clean up staging", async () => {
  const before = await stagedDirectories();
  const duplicateField = new FormData(); duplicateField.append("organization_id", "one"); duplicateField.append("organization_id", "two");
  const duplicateFile = new FormData(); duplicateFile.append("file", new File(["one"], "one.mp4")); duplicateFile.append("file", new File(["two"], "two.mp4"));
  const textFile = new FormData(); textFile.set("file", "not a file");
  const wrongFile = new FormData(); wrongFile.set("other", new File(["data"], "other.mp4"));
  const longField = new FormData(); longField.set("organization_id", "x".repeat(4097));
  const cases: [Request, number][] = [
    [new Request("http://localhost/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: "invalid" }), 400],
    [new Request("http://localhost/api/upload", { method: "POST", headers: { "content-type": "multipart/form-data;" }, body: "invalid" }), 400],
    [new Request("http://localhost/api/upload", { method: "POST", headers, body: "invalid" }), 400],
    [new Request("http://localhost/api/upload", { method: "POST", headers, body: Buffer.concat([fileHeader, Buffer.from("truncated")]) }), 400],
    [await encodedFormRequest(duplicateField), 400],
    [await encodedFormRequest(duplicateFile), 413],
    [await encodedFormRequest(textFile), 400],
    [await encodedFormRequest(wrongFile), 400],
    [await encodedFormRequest(longField), 413],
  ];
  for (const [request, status] of cases) {
    await assert.rejects(readUploadForm(request), rejectsStatus(status));
    assert.deepEqual(await stagedDirectories(), before);
  }
  const recovered = await readUploadForm(smallRequest()); await recovered.dispose();
});

test("declared oversize and chunked 512 MiB + 1 byte reject without retaining temporary data", async () => {
  const before = await stagedDirectories();
  await assert.rejects(readUploadForm(new Request("http://localhost/api/upload", {
    method: "POST", headers: { ...headers, "content-length": String(MAX_MULTIPART_BYTES + 1) }, body: "x",
  })), rejectsStatus(413));
  const source = lazyMultipart(getUploadSourceLimitBytes("video") + 1, true);
  await assert.rejects(readUploadForm(streamRequest(source.body)), rejectsStatus(413));
  assert.equal(source.cancelled, true);
  assert.ok(source.chunks <= 516, "the request is stopped at the file boundary");
  assert.deepEqual(await stagedDirectories(), before);
});

test("aborting an unfinished upload cancels its stream and frees its staging slot", async () => {
  const before = await stagedDirectories();
  const abort = new AbortController();
  let sent = false, cancelled = false, signalRead!: () => void;
  const read = new Promise<void>(resolve => { signalRead = resolve; });
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) { sent = true; controller.enqueue(fileHeader); return; }
      signalRead(); return new Promise<void>(() => {});
    },
    cancel() { cancelled = true; },
  });
  const pending = readUploadForm(streamRequest(stream, abort.signal));
  const rejected = assert.rejects(pending, rejectsStatus(400));
  await read; abort.abort(); await rejected;
  assert.equal(cancelled, true); assert.deepEqual(await stagedDirectories(), before);
  const recovered = await readUploadForm(smallRequest()); await recovered.dispose();
});

test("two live disk-backed forms bound concurrency until disposal", async () => {
  const before = await stagedDirectories();
  const first = await readUploadForm(smallRequest()), second = await readUploadForm(smallRequest());
  try {
    await assert.rejects(readUploadForm(smallRequest()), rejectsStatus(429));
    await first.dispose();
    const third = await readUploadForm(smallRequest());
    try {
      assert.equal((await stagedDirectories()).length, before.length + 2);
      const file = second.form.get("file"); assert.ok(file instanceof File);
      assert.equal((await file.slice(-1).arrayBuffer()).byteLength, 1);
    } finally { await third.dispose(); }
  } finally { await first.dispose(); await second.dispose(); }
  assert.deepEqual(await stagedDirectories(), before);
});

test("installed Next matcher excludes only the upload route from proxy body cloning", async () => {
  Object.assign(globalThis, { AsyncLocalStorage });
  const [{ unstable_doesMiddlewareMatch }, { config }] = await Promise.all([
    import("next/experimental/testing/server"), import("../proxy"),
  ]);
  for (const path of ["/api/upload", "/api/upload/", "/api/upload?type=video", "/api/upload/?type=video"])
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://app.test${path}` }), false, path);
  for (const path of ["/api/uploads", "/api/upload-extra", "/api/upload/child", "/manage/assets", "/api/organizations"])
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://app.test${path}` }), true, path);
});

test("a real HTTP upload accepts exactly 512 MiB incrementally and preserves the final byte", async () => {
  const before = await stagedDirectories();
  const server = createServer(async (incoming, response) => {
    try {
      const init: RequestInit & { duplex: "half" } = {
        method: "POST", headers: { "content-type": incoming.headers["content-type"] ?? "" },
        body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half",
      };
      const parsed = await readUploadForm(new Request("http://localhost/api/upload", init));
      let result;
      try {
        const file = parsed.form.get("file"); assert.ok(file instanceof File);
        const tail = new Uint8Array(await file.slice(-1).arrayBuffer())[0];
        result = { size: file.size, tail, organization: parsed.form.get("organization_id") };
      } finally { await parsed.dispose(); }
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : "upload failed");
    }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const size = getUploadSourceLimitBytes("video"), source = lazyMultipart(size);
    const init: RequestInit & { duplex: "half" } = { method: "POST", headers, body: source.body, duplex: "half" };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/upload`, init);
    const result = await response.text();
    assert.equal(response.status, 200, result);
    assert.deepEqual(JSON.parse(result), { size, tail: 123, organization: "team" });
    assert.deepEqual(await stagedDirectories(), before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
