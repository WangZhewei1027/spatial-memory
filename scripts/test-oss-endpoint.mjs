import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve("ali-oss"));

test("OSS uploads use the configured network endpoint and return the public media URL", async (t) => {
  Object.assign(process.env, {
    OSS_REGION: "oss-cn-shanghai",
    OSS_BUCKET: "fixture-bucket",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "fixture",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "fixture",
    NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.example.test",
  });
  const transport = t.mock.method(sdkRequire("urllib"), "request", async () => ({ status: 200, headers: {} }));
  const storage = require.resolve("../lib/storage/oss.ts");
  for (const [internal, dualStack, host] of [
    [false, false, "oss-cn-shanghai.aliyuncs.com"],
    [false, true, "cn-shanghai.oss.aliyuncs.com"],
    [true, true, "oss-cn-shanghai-internal.aliyuncs.com"],
  ]) {
    process.env.OSS_INTERNAL = String(internal);
    process.env.OSS_USE_DUALSTACK = String(dualStack);
    delete require.cache[storage];
    const url = await require(storage).putObject("assets/test.png", Buffer.from("fixture"), { contentType: "image/png" });
    assert.equal(url, "https://media.example.test/assets/test.png");
    const [endpoint, options] = transport.mock.calls.at(-1).arguments;
    assert.equal(options.method, "PUT");
    assert.equal(new URL(endpoint).origin, `https://fixture-bucket.${host}`);
  }
});
