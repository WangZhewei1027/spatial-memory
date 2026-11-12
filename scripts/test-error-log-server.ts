import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createSourceMapResolver } from "../lib/errors/source-maps.server";
import { symbolicateStack } from "../lib/errors/stack-frames";
import { errorLogValues } from "../lib/log-error";

// Line 1: column 0 → page.tsx 1:0 "boom"; column 10 → page.tsx 5:2.
const map = (source: string) => JSON.stringify({ version: 3, sources: [source], names: ["boom"], mappings: "AAAAA,UAIE" });

test("server failures keep the stack, code and release", () => {
  const error = Object.assign(new Error("relation missing"), { code: "42P01" });
  const values = errorLogValues({ method: "GET", path: "/api/x", status: 500, error, context: { routeType: "render" } });
  assert.equal(values.scope, "api");
  assert.equal(values.message, "relation missing");
  const context = JSON.parse(values.context);
  assert.equal(context.code, "42P01");
  assert.equal(context.routeType, "render");
  assert.equal(context.release, "dev");
  assert.match(context.stack, /relation missing/);

  const explicit = errorLogValues({ scope: "server", status: 403, message: "权限不足" });
  assert.equal(explicit.scope, "server");
  assert.equal(explicit.message, "权限不足");
  assert.deepEqual(JSON.parse(explicit.context), { release: "dev" });
});

test("client stacks resolve from extracted source maps only", async () => {
  const base = await mkdtemp(join(tmpdir(), "client-sourcemaps-"));
  const root = join(base, "maps");
  try {
    for (const [file, source] of [["chunks/app/manage/page-1.js", "webpack://_N_E/./app/manage/page.tsx?x"], ["chunks/app/[id]/page-2.js", "webpack://_N_E/./app/[id]/page.tsx"]]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, `${file}.map`), map(source));
    }
    await writeFile(join(base, "outside.js.map"), map("secret.ts"));
    const resolve = createSourceMapResolver(root);

    const stack = [
      "Error: boom",
      "    at a (https://example.test/_next/static/chunks/app/manage/page-1.js:1:1)",
      "    at b (https://example.test/_next/static/chunks/app/manage/page-1.js:1:13)",
      "    at c (https://example.test/_next/static/chunks/app/%5Bid%5D/page-2.js:1:1)",
      "    at d (https://example.test/_next/static/chunks/missing.js:1:1)",
    ].join("\n");
    assert.equal(await symbolicateStack(stack, resolve), [
      "Error: boom",
      "    at a (app/manage/page.tsx:1:1 [boom])",
      "    at b (app/manage/page.tsx:5:3)",
      "    at c (app/[id]/page.tsx:1:1 [boom])",
      "    at d (https://example.test/_next/static/chunks/missing.js:1:1)",
    ].join("\n"));

    assert.equal(await resolve("../outside.js", 1, 0), null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
