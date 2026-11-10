/** Multi-image recognition targets: resource rules, editing and the public version; no database. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { referenceImagesOf, referenceResources } from "../app/manage/components/AssetEditor/anchor-references";
import { MAX_ANCHOR_REFERENCES, type AssetResourceDto } from "../lib/content-model/contracts";
import { parseResourceInputs } from "../lib/content-model/payload";
import { referenceVersion } from "../lib/anchor/reference-version";

const id = (n: number) => `10190000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const file = (role: AssetResourceDto["role"], ordinal: number): AssetResourceDto => ({
  role, ordinal, storage_key: null, external_url: null, url: `https://media.test/${role}-${ordinal}.jpg`,
  managed: true, content_hash: null, mime_type: "image/jpeg", size_bytes: 1,
});

test("an anchor accepts up to the reference limit and still requires ordinal 0", () => {
  const refs = (count: number) => Array.from({ length: count }, (_, ordinal) => ({ role: "reference", ordinal, receiptId: id(ordinal + 1) }));
  assert.equal(parseResourceInputs("anchor", refs(MAX_ANCHOR_REFERENCES)).length, MAX_ANCHOR_REFERENCES);
  assert.throws(() => parseResourceInputs("anchor", refs(MAX_ANCHOR_REFERENCES + 1)), /最多/);
  assert.throws(() => parseResourceInputs("anchor", [{ role: "reference", ordinal: 1, receiptId: id(1) }]), /序号为 0/);
});

test("reference images read in ordinal order, falling back to a legacy primary file", () => {
  const images = referenceImagesOf({ resources: [file("reference", 2), file("reference", 0), file("reference", 1)] });
  assert.deepEqual(images.map((image) => image.ordinal), [0, 1, 2]);
  assert.deepEqual(referenceImagesOf({ resources: [file("primary", 0), file("thumbnail", 0)] }).map((image) => image.role), ["primary"]);
});

test("editing keeps existing files by reference and renumbers kept and uploaded images from 0", () => {
  const asset = { id: id(9) };
  const kept = [file("reference", 0), file("reference", 2)];
  assert.deepEqual(referenceResources(asset, kept, [id(5)]), [
    { role: "reference", ordinal: 0, fromAssetId: asset.id, fromRole: "reference", fromOrdinal: 0 },
    { role: "reference", ordinal: 1, fromAssetId: asset.id, fromRole: "reference", fromOrdinal: 2 },
    { role: "reference", ordinal: 2, receiptId: id(5) },
  ]);
  // A legacy primary image becomes the first reference image.
  assert.deepEqual(referenceResources(asset, [file("primary", 0)], []), [
    { role: "reference", ordinal: 0, fromAssetId: asset.id, fromRole: "primary", fromOrdinal: 0 },
  ]);
  // The server accepts exactly what the panel sends.
  assert.equal(parseResourceInputs("anchor", referenceResources(asset, kept, [id(5)])).length, 3);
});

test("reference version is unchanged for one image and covers every image and its order", () => {
  const updatedAt = new Date("2026-11-10T08:00:00Z");
  const legacy = createHash("sha256").update(`https://media.test/a.jpg:${updatedAt}`).digest("hex");
  assert.equal(referenceVersion(["https://media.test/a.jpg"], updatedAt), legacy);
  const two = referenceVersion(["https://media.test/a.jpg", "https://media.test/b.jpg"], updatedAt);
  assert.notEqual(two, legacy);
  assert.notEqual(two, referenceVersion(["https://media.test/b.jpg", "https://media.test/a.jpg"], updatedAt));
  assert.match(two, /^[a-f0-9]{64}$/);
});
