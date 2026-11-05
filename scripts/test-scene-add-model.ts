import { normalizeDefinition, toDocument, type EditorDefinition } from "@/app/manage/lib/scene-document";
import { addModelInstance, replaceInstanceAsset, resourceKey } from "@/app/manage/scenes/components/scene-add-model";
import type { SceneResource } from "@/app/manage/scenes/components/types";
import { createBlankScene } from "@/lib/scene/protocol";
import assert from "node:assert/strict";

const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const resource = (assetId: string, assetNo: number, extra: Partial<SceneResource> = {}): SceneResource => ({
  assetId: assetId, name: "小星星", url: `https://media.example/${assetId}.glb`, assetLockVersion: assetNo,
  assetState: "active", ...extra,
});
const blank = (schemaVersion: 6): EditorDefinition => ({ schemaVersion, content: { ...createBlankScene().content, assets: {} } });
let aliases = 0;
const createAlias = () => `m${++aliases}`;
let ids = 0;
/** Mirrors SceneEditor.addModel: the registered map is the render snapshot, `picked` is the clicked resource. */
function add(definition: EditorDefinition, key: string, registered: Record<string, SceneResource>, picked?: SceneResource) {
  const result = addModelInstance(definition.content, { key, resource: picked ?? registered[key], id: `model_${++ids}`, position: [0, 0, 0], createAlias });
  return result.ok ? { ok: true as const, definition: normalizeDefinition({ ...definition, content: result.content }) } : result;
}
const expectOk = (result: ReturnType<typeof add>) => { assert.ok(result.ok, `expected success, got ${!result.ok && result.reason}`); return result.definition; };

// First add from the project/shared library or an upload: the editor has not registered the resource yet.
const empty = blank(6);
const before = structuredClone(empty);
const first = expectOk(add(empty, V1, {}, resource(V1, 1)));
assert.deepEqual(empty, before, "the input document is never mutated");
assert.deepEqual(Object.values(first.content.assets), [{ assetId: V1 }], "first add references the picked asset");
assert.equal(first.content.instances.length, 1);
assert.equal(first.content.assets[first.content.instances[0].asset!].assetId, V1);
assert.deepEqual(toDocument(first).content.assets, first.content.assets, "the new draft serializes as schema 4 with asset references");

// The old flow read only the stale snapshot; without a picked resource, failure is graceful, not a TypeError.
assert.deepEqual(add(empty, V1, {}), { ok: false, reason: "missing" });
assert.deepEqual(add(empty, V1, {}, resource(V2, 2)), { ok: false, reason: "missing" }, "a resource for another asset is never pinned under this key");
assert.deepEqual(add(empty, V1, {}, resource(V1, 1, { url: null })), { ok: false, reason: "missing" }, "a asset without a file is not added");
assert.deepEqual(add(empty, "", {}, resource(V1, 1, { assetId: "" })), { ok: false, reason: "missing" });

// Repeating the same asset (button, upload dedup or drag) reuses one alias.
const repeated = expectOk(add(first, V1, { [V1]: resource(V1, 1) }, resource(V1, 1)));
const repeatedFromDrop = expectOk(add(repeated, V1, {}));
assert.equal(Object.keys(repeatedFromDrop.content.assets).length, 1, "no duplicate alias for a repeated asset");
assert.equal(new Set(repeatedFromDrop.content.instances.map((item) => item.asset)).size, 1);
assert.equal(repeatedFromDrop.content.instances.length, 3);

// Another asset coexists under its own alias.
const both = expectOk(add(repeatedFromDrop, V2, {}, resource(V2, 2)));
assert.deepEqual(Object.values(both.content.assets).map((ref) => ref.assetId).sort(), [V1, V2].sort());
assert.equal(resourceKey(both.content.assets[both.content.instances[3].asset!]), V2);

// Archived assets cannot be newly referenced, but existing references may gain instances.
assert.deepEqual(add(empty, V1, {}, resource(V1, 1, { assetState: "archived" })), { ok: false, reason: "archived" });
expectOk(add(first, V1, {}, resource(V1, 1, { assetState: "archived" })));

// Large compositions are not truncated by authoring.
let full = blank(6);
for (let index = 0; index < 25; index++) full = expectOk(add(full, V1, {}, resource(V1, 1)));
assert.equal(expectOk(add(full, V1, {}, resource(V1, 1))).content.instances.length, 26);
let many = blank(6);
const assets = Array.from({ length: 10 }, (_, index) => `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`);
for (const asset of assets.slice(0, -1)) many = expectOk(add(many, asset, {}, resource(asset, 1)));
assert.equal(Object.keys(expectOk(add(many, assets.at(-1)!, {}, resource(assets.at(-1)!, 1))).content.assets).length, 10);
expectOk(add(many, assets[0], {}));

// Replacing a track's source keeps the track and swaps only the asset reference.
const V3 = "55555555-5555-4555-8555-555555555555";
const track = { ...first.content.instances[0], name: "主角", position: [1, 0, 2] as [number, number, number], timing: { startSeconds: 2, endSeconds: 6, fadeInSeconds: 0, fadeOutSeconds: 0 },
  animation: { clipName: "Walk", startSeconds: 2, loop: true } };
const withTrack = normalizeDefinition({ ...first, content: { ...first.content, instances: [track] } });
const swapped = replaceInstanceAsset(withTrack.content, { id: track.id, key: V3, resource: resource(V3, 3, { kind: "model", animations: [{ index: 0, name: "Walk" }] }), from: resource(V1, 1), createAlias });
assert.ok(swapped.ok);
const swappedTrack = swapped.content.instances[0];
assert.equal(swapped.content.assets[swappedTrack.asset!].assetId, V3);
assert.deepEqual({ ...swappedTrack, asset: track.asset }, track, "name, transform, timing and a compatible clip are kept");
assert.deepEqual(Object.values(swapped.content.assets), [{ assetId: V3 }], "the unused alias is removed");
normalizeDefinition({ ...withTrack, content: swapped.content });
const noClip = replaceInstanceAsset(withTrack.content, { id: track.id, key: V3, resource: resource(V3, 3, { animations: [] }), from: resource(V1, 1), createAlias });
assert.ok(noClip.ok && noClip.content.instances[0].animation === null, "a clip the new model lacks is cleared");
assert.deepEqual(replaceInstanceAsset(withTrack.content, { id: track.id, key: V3, resource: resource(V3, 3, { kind: "image" }), from: resource(V1, 1), createAlias }), { ok: false, reason: "kind" });
assert.deepEqual(replaceInstanceAsset(withTrack.content, { id: track.id, key: V3, resource: resource(V3, 3, { assetState: "archived" }), from: resource(V1, 1), createAlias }), { ok: false, reason: "archived" });
assert.deepEqual(replaceInstanceAsset(withTrack.content, { id: track.id, key: V3, resource: undefined, from: resource(V1, 1), createAlias }), { ok: false, reason: "missing" });
const same = replaceInstanceAsset(withTrack.content, { id: track.id, key: V1, resource: resource(V1, 1), from: resource(V1, 1), createAlias });
assert.ok(same.ok && same.content === withTrack.content, "dropping the current asset is a no-op");
// Shared aliases stay while another instance still uses them; trims past the new file's end are reset.
const audio = (id: string, trimStartSeconds: number, trimEndSeconds: number | null) => ({ ...track, id, animation: null, media: { trimStartSeconds, trimEndSeconds, playbackRate: 1 as const, volume: .5, loop: false, muted: false } });
const shared = { ...withTrack.content, instances: [audio("a", 1, 9), audio("b", 12, null)] };
const shorter = (id: string) => replaceInstanceAsset(shared, { id, key: V3, resource: resource(V3, 3, { kind: "audio", durationSeconds: 8 }), from: resource(V1, 1, { kind: "audio" }), createAlias });
const trimmed = shorter("a");
assert.ok(trimmed.ok);
assert.deepEqual(trimmed.content.instances[0].media, { ...shared.instances[0].media, trimEndSeconds: null }, "an end past the new duration is cleared");
assert.equal(Object.keys(trimmed.content.assets).length, 2, "the old alias remains for the other instance");
const restarted = shorter("b");
assert.ok(restarted.ok && restarted.content.instances[1].media?.trimStartSeconds === 0, "a start past the new duration restarts the source");

console.log("PASS picked asset, missing resource, shared alias, asset coexistence, archived, large compositions and same-kind replacement");
