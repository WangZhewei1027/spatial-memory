import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { generateModelThumbnail } from "../lib/upload/model-thumbnail.server";
import { processUploadMedia } from "../lib/upload/media-processing.server";
import { ContentError } from "../lib/content-model/errors";

import { dracoModelGltf, meshoptModelGltf, modelGlb, modelGltf } from "./test-support/model-thumbnail-fixtures";

async function assertVisiblePng(buffer: Buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let redPixels = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if (data[i] > data[i + 1] * 1.5 && data[i] > data[i + 2] * 1.5) redPixels++;
  assert.ok(redPixels > 5_000, `model geometry should be visible, found ${redPixels} red pixels`);
}

test("server renders self-contained glTF and GLB as visible, repeatable 512px PNGs", async () => {
  const first = await generateModelThumbnail(modelGlb());
  const second = await generateModelThumbnail(modelGlb());
  await assertVisiblePng(first);
  assert.deepEqual(first, second, "fixed camera and lighting give stable derived bytes");
  await assertVisiblePng(await generateModelThumbnail(Buffer.from(JSON.stringify(modelGltf()))));
});

test("model upload keeps the original bytes and supplies a separately generated PNG", async () => {
  const source = modelGlb();
  const result = await processUploadMedia(new File([new Uint8Array(source)], "triangle.glb", { type: "model/gltf-binary" }), "model");
  assert.deepEqual(result.buffer, source);
  assert.equal(result.thumbnail?.mimeType, "image/png");
  assert.ok(result.thumbnail);
  await assertVisiblePng(result.thumbnail.buffer);
});

test("Draco and Meshopt models render with bundled local decoders", async () => {
  await assertVisiblePng(await generateModelThumbnail(dracoModelGltf()));
  await assertVisiblePng(await generateModelThumbnail(meshoptModelGltf()));
});

test("concurrent model renders return a retryable error and leave the admitted render intact", async () => {
  const first = generateModelThumbnail(modelGlb());
  await assert.rejects(generateModelThumbnail(modelGlb()), (error: unknown) => error instanceof ContentError && error.status === 429);
  await assertVisiblePng(await first);
});

test("external URLs, local files, invalid envelopes and empty geometry fail before producing a thumbnail", async () => {
  const invalid = (error: unknown) => error instanceof ContentError && error.code === "VALIDATION_FAILED";
  for (const uri of ["https://127.0.0.1/private.bin", "file:///etc/passwd", "texture.png", "data:text/html;base64,PHNjcmlwdD4="]) {
    const document = modelGltf(); document.buffers[0].uri = uri;
    await assert.rejects(generateModelThumbnail(Buffer.from(JSON.stringify(document))), invalid);
  }
  await assert.rejects(generateModelThumbnail(Buffer.from("not a model")), invalid);
  const corrupt = modelGlb(); corrupt.writeUInt32LE(corrupt.length + 1, 8);
  await assert.rejects(generateModelThumbnail(corrupt), invalid);
  const excessive = modelGltf(); excessive.accessors[0].count = 2_000_001;
  await assert.rejects(generateModelThumbnail(Buffer.from(JSON.stringify(excessive))), invalid);
  await assert.rejects(generateModelThumbnail(Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 }))), invalid);
  await assertVisiblePng(await generateModelThumbnail(modelGlb()));
});
