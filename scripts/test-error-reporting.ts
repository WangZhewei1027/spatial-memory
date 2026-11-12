import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError, stripQuery } from "../lib/errors/describe";
import { MAX_CLIENT_CONTEXT_BYTES, parseClientErrorReport } from "../lib/errors/ingest";
import { chunkFile, cleanSourcePath, symbolicateStack, type PositionResolver } from "../lib/errors/stack-frames";

test("thrown values keep stack, code, cause and digest within bounds", () => {
  const error = Object.assign(new Error("insert failed", { cause: new TypeError("socket closed") }), { code: "23505", digest: "123" });
  const description = describeError(error);
  assert.equal(description.message, "insert failed");
  assert.equal(description.name, "Error");
  assert.equal(description.code, "23505");
  assert.equal(description.digest, "123");
  assert.equal(description.cause, "TypeError: socket closed");
  assert.match(description.stack ?? "", /insert failed/);

  assert.deepEqual(describeError({ reason: "quota" }), { message: '{"reason":"quota"}' });
  assert.deepEqual(describeError("plain"), { message: "plain" });
  assert.equal(describeError(new Error("x".repeat(5000))).message.length, 2000);
});

test("report paths drop query strings and fragments", () => {
  assert.equal(stripQuery("/invite/abc?token=secret#x"), "/invite/abc");
  assert.equal(stripQuery("/manage"), "/manage");
});

test("client reports keep full origin names and stamp the release", () => {
  for (const method of ["unhandledrejection", "react.global-error"]) {
    assert.equal(parseClientErrorReport({ method }, "r1").method, method);
  }
  const record = parseClientErrorReport({ method: "fetch", path: "/api/x?token=1", status: 0, message: "boom", release: "r0", context: { stack: "s" } }, "r1");
  assert.equal(record.path, "/api/x");
  assert.equal(record.status, 0);
  assert.deepEqual(record.context, { stack: "s", release: "r0", server_release: "r1" });
  assert.deepEqual(parseClientErrorReport(null, "r1"), { method: null, path: null, status: null, message: null, context: { release: "r1" } });
});

test("oversized anonymous context is replaced by a bounded stack", () => {
  const record = parseClientErrorReport({ context: { blob: "x".repeat(MAX_CLIENT_CONTEXT_BYTES), stack: "y".repeat(MAX_CLIENT_CONTEXT_BYTES) } }, "r1");
  assert.equal(record.context.truncated, true);
  assert.equal(record.context.blob, undefined);
  assert.equal((record.context.stack as string).length, MAX_CLIENT_CONTEXT_BYTES / 2);
});

test("chunk paths cannot leave the static directory", () => {
  assert.equal(chunkFile("chunks/app/%5Bid%5D/page-1.js"), "chunks/app/[id]/page-1.js");
  for (const raw of ["chunks/../../secret.js", "chunks/%2e%2e/secret.js", "/etc/x.js", "chunks//x.js", "chunks/%E0%A4%A.js"]) {
    assert.equal(chunkFile(raw), null, raw);
  }
  assert.equal(cleanSourcePath("webpack://_N_E/./app/page.tsx?abc"), "app/page.tsx");
});

test("browser stacks map to original positions and keep unresolved frames", async () => {
  const calls: string[] = [];
  const resolve: PositionResolver = async (file, line, column) => {
    calls.push(`${file}:${line}:${column}`);
    return file === "chunks/main.js" ? { source: "webpack://_N_E/./app/page.tsx", line: 12, column: 4, name: "save" } : null;
  };
  const stack = [
    "TypeError: x is undefined",
    "    at a (https://example.test/_next/static/chunks/main.js:1:200)",
    "b@https://example.test/_next/static/chunks/other.js:3:7",
    "    at c (https://example.test/_next/static/chunks/../../etc/passwd.js:1:1)",
  ].join("\n");
  assert.equal(await symbolicateStack(stack, resolve), [
    "TypeError: x is undefined",
    "    at a (app/page.tsx:12:5 [save])",
    "b@https://example.test/_next/static/chunks/other.js:3:7",
    "    at c (https://example.test/_next/static/chunks/../../etc/passwd.js:1:1)",
  ].join("\n"));
  assert.deepEqual(calls, ["chunks/main.js:1:199", "chunks/other.js:3:6"]);

  assert.equal(await symbolicateStack("Error\n    at native", resolve), null);
  assert.equal(await symbolicateStack("at https://example.test/_next/static/chunks/other.js:1:1", resolve), null);
  assert.equal(await symbolicateStack("at https://example.test/_next/static/chunks/main.js:1:1", async () => { throw new Error("bad map"); }), null);
});
