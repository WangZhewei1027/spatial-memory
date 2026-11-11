/** Receipt/retention boundary regressions; pure, no storage or network access. */
import assert from "node:assert/strict";

async function main() {
  // Set before dynamic imports: media URL configuration is captured at module load.
  process.env.NEXT_PUBLIC_MEDIA_BASE_URL = "https://media.example.test/media";
  const { mediaKeyFromUrl } = await import("../lib/storage/public-url");
  const { parseAssetPayload, parseResourceInputs } = await import("../lib/content-model/payload");
  for (const url of [
    "https://media.example.test/media/assets/a.glb",
    "https://MEDIA.EXAMPLE.TEST/media/assets/a.glb",
    "https://media.example.test:443/media/assets/a.glb",
    "https://media.example.test/media/assets/a.glb?download=1#part",
  ]) {
    assert.equal(mediaKeyFromUrl(url), "assets/a.glb", "equivalent managed URLs resolve to the same retained key");
    assert.throws(() => parseResourceInputs("model", [{ role: "primary", externalUrl: url }]), "managed URLs require a receipt or authorized version reference");
    assert.throws(() => parseAssetPayload("model", { kind: "model", attributes: { note: `linked media: ${url}` } }), "embedded managed URLs cannot bypass the resource manifest");
    assert.throws(() => parseAssetPayload("anchor", { kind: "anchor", text: `reference image: ${url}` }), "optional anchor text cannot bypass the resource manifest");
  }
  for (const url of [
    "https://media.example.test.evil.test/media/assets/a.glb",
    "https://media.example.test/media-other/assets/a.glb",
    "https://other.example.test/media/assets/a.glb",
  ]) assert.equal(mediaKeyFromUrl(url), null, "different host/path is not a managed object");
  assert.equal(mediaKeyFromUrl("https://media.example.test/media/assets/%E6%A0%91.glb"), "assets/树.glb");
  assert.throws(() => parseResourceInputs("model", [{ role: "primary", ordinal: 1, externalUrl: "https://fixture.invalid/a.glb" }]), "a playable asset requires primary resource ordinal 0");
  assert.equal(parseResourceInputs("model", [{ role: "primary", ordinal: 0, externalUrl: "https://fixture.invalid/a.glb" }]).length, 1);
  console.log("PASS canonical managed URLs, embedded references, primary resource selection");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
