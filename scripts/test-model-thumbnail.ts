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

test("lighting preserves middle gray and the chroma of colored materials", async () => {
  // The center of this flat triangle is entirely foreground. Compare diffuse
  // materials against an unlit gray swatch to catch overexposure without
  // baking any light or tone-mapper settings into the test.
  async function swatch(red: number, green: number, blue: number, unlit = false) {
    const gltf = modelGltf();
    const material = gltf.materials[0];
    const document = {
      ...gltf,
      ...(unlit ? { extensionsUsed: ["KHR_materials_unlit"] } : {}),
      materials: [{
        ...material,
        pbrMetallicRoughness: { baseColorFactor: [red, green, blue, 1], metallicFactor: 0, roughnessFactor: 1 },
        ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
      }],
    };
    const png = await generateModelThumbnail(Buffer.from(JSON.stringify(document)));
    const crop = await sharp(png).extract({ left: 240, top: 240, width: 32, height: 32 }).removeAlpha().png().toBuffer();
    return (await sharp(crop).stats()).channels.map((channel) => Math.round(channel.mean));
  }

  const [gray] = await swatch(0.18, 0.18, 0.18);
  assert.ok(gray >= 90 && gray <= 155, `18% diffuse gray should read as a midtone, got ${gray}/255`);
  const [red, , blue] = await swatch(1, 0.6, 0.02);
  assert.ok(red >= 170 && red - blue >= 110, `yellow should be bright and saturated, got R=${red}, B=${blue}`);
  const [neutral] = await swatch(0.18, 0.18, 0.18, true);
  assert.ok(neutral >= 110 && neutral <= 145, `unlit gray should retain its own midtone, got ${neutral}/255`);
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
