# Scene Authoring

Pure, deterministic authoring for Spatial Memory scene documents (schema 6). The CLI and Web editor use the same operations and validation. The installed ESM bundle has no runtime dependency on the Web checkout, Three.js installation or Scene Core installation. It performs no I/O, persistence or authorization.

```sh
npm run build
npm test
npm pack
```

`build` emits `dist/index.js` and TypeScript declarations. Three's matrix math and the current Scene Core sampling implementation are bundled. Build prerequisites are declared as development dependencies. `npm pack` builds before packing; installing the resulting tarball does not build sources.

The protocol and validator source files in this package are canonical. Web `lib/scene` forwards to them. Do not copy a separate validator into the CLI; rebuild this package when shared document semantics or Scene Core changes.

## Public interface

```ts
import { createDocument, validate, apply, inspect, sample, diff } from '@spatial-memory/scene-authoring';

const document = createDocument();
const next = apply(document, [
  { type: 'asset.set', alias: 'statue', assetId: '11111111-1111-4111-8111-111111111111' },
  { type: 'node.add', kind: 'instance', node: {
    id: 'statue_1', asset: 'statue', animation: null,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  } },
]);
if (next.ok) console.log(sample(next.document, { time: 0 }));
```

- `createDocument()` returns an empty 10-second schema-6 document.
- `validate(unknown, options?)` and its alias `parse` return `{ok:true, document, warnings, diagnostics}` or `{ok:false, errors, diagnostics}`. `parse` does **not** throw.
- `apply(document, operations, options?)` returns a new document, `changes`, `applied`, `unchanged`, `warnings` and `diagnostics`. A failed batch returns no partial document. Inputs are never mutated. Final schema errors identify the operation that first introduced the unresolved issue.
- `inspect(document, options?)` returns `{ok:true, inspection, ...}` with IDs, hierarchy, resources, tracks, scheduling regions and counts.
- `sample(document, time | {time,nodeIds?,listener?,resources?})` returns `{ok:true, sample:{time,durationSeconds,nodes}, ...}`. `nodes` is keyed by node ID; `worldMatrix` uses column-major order. Sampling accepts nonnegative times beyond the document's current end, allowing inspection of retained future keys; it neither loops nor silently clamps. Playback/render adapters must explicitly choose their timeline policy.
- `diff(before, after)` returns `{ok:true, changes, ...}`. Node changes use stable IDs rather than shifting array indices; track order is reported separately.

Failures contain `code`, `path`, `message`, optional `opIndex` and `nodeId`, and `severity`. Successful no-change batches return `unchanged:true` and `NO_CHANGE`; missing nodes/keys and key-time collisions fail explicitly. No operation silently clamps coordinates, time or keyframe values.

`options.resources` is an optional map keyed by asset UUID, containing `ResourceFact` (`assetId`, `kind`, optional `durationSeconds`, `animations`, `state`, `name`). `requireResources:true` requires each referenced asset to have facts. Facts check kinds and clip existence; the server still verifies current team ownership, archival rules and files when saving. The module does not generate resource URLs or upload models.

## Operations

Every operation uses the `type` discriminator. `Operation` is exported with complete TypeScript definitions. Unknown operation types and fields are rejected.

| Type | Fields |
| --- | --- |
| `document.replace` | `document`: complete schema-6 document |
| `scene.update` | `patch`: content fields; optional `unset` |
| `asset.set` / `asset.remove` | `alias`; set also requires `assetId` |
| `node.add` | `kind: "instance" | "group"`, complete `node`, optional `beforeId` of the same kind |
| `node.update` | `id`, `patch`, optional `unset` |
| `node.remove` | `id`, `descendants: "reject" | "remove" | "reparent"` (default `reject`) |
| `node.duplicate` | `id`, complete `idMap` for the node and every descendant |
| `node.reparent` | `id`, `parentId` or `null`, `preserve: "local" | "world"`; world requires `time`, optional `write` |
| `node.reorder` | `ids`: every instance ID exactly once |
| `transform.set` | `id`, `value` containing position/rotation/scale, optional `space`, `write`, `time` |
| `transform.lookAt` | `id`, world `target`, `time`, optional `up`, `forwardAxis`, `write` |
| `track.set` / `track.remove` | `id`, `channel`; set requires complete `keys`; remove optionally `retainAt` |
| `key.set` | `id`, `channel`, complete `key` (upserts exact time) |
| `key.remove` / `key.move` | `id`, `channel`; remove uses `time`, move uses `from` and `to` |
| `time.shift` | `ids`, `seconds`, optional `includeDescendants`, `scope` |
| `time.stretch` | `ids`, positive `factor`, optional `origin`, `includeDescendants`, `scope` |
| `time.sequence` | ordered `ids`, optional `start`, `gap`, `includeDescendants` |
| `layout` | `ids`, `pattern: "line" | "grid" | "circle"`, optional `origin`, `step`, `rowStep`, `columns`, `radius`, `plane`, `startAngle`, `space`, `write`, `time` |
| `layout.align` | `ids`, `axis`, optional `value` or `mode: "min" | "center" | "max"`, `space`, `write`, `time` |
| `layout.distribute` | ordered `ids`, `axis`, optional `start`, `end`, `space`, `write`, `time` |

Patches recursively merge objects, replace arrays, and retain unspecified fields. `unset` takes relative RFC 6901 pointers such as `/media/spatial` or `/tracks/position.x`; unsetting a missing path fails. `null` is a value, not deletion. `node.update` cannot change stable identity or node kind. Use full replacement for an intentionally different document shape. Arbitrary script, light, camera and geometry fields are not schema-6 content.

Static transforms are parent-local meters, Euler XYZ radians and scale factors. `space` defaults to `local`; `write` defaults to `base`. `write:"key"` always requires a time and keys every axis of each supplied transform field, preserving existing custom Bezier handles. World operations always require `time` and sample animated ancestors at that time. World-position-only changes can be represented under sheared parents; other unrepresentable world transforms return `NON_TRS_*` errors. Reparenting preserves either local values or a pose at one specified time; it does not bake an entire world trajectory. A keyed node needs `write:"key"` when preserving world pose. Base edits under existing tracks report `BASE_SHADOWED_BY_TRACK`.

`track.remove` without `retainAt` restores the existing base value; with `retainAt`, it first records that sampled value as the base. Removing a final individual key restores the pre-existing base value. Key times are exact numbers, without the editor gesture's millisecond snapping or matching tolerance. Bezier curves and hold flags are retained unless explicitly changed.

Time operations default to all three scopes (`timing`, `animation`, `tracks`) and include descendants once. Source trim times are independent and do not shift. Stretching scales timing fades and scheduling windows, while source media continues at natural 1x speed. Media `playbackRate` is reserved at `1`; other values and the removed `retimeMedia` operation option are rejected. GLB clip speed has no document field, so stretch emits `GLB_SPEED_UNCHANGED` when relevant. Sequence uses explicit timing, known source/clip duration, or the document duration; an unbounded region fails. Negative gaps intentionally allow overlaps. None of these operations extends or trims the scene duration automatically; add `scene.update` to the same batch if desired.

Layouts position instance/group origins, not mesh bounds. Grid uses the provided column and row vectors; circle uses radians and a coordinate plane. Align defaults to the midpoint between the minimum and maximum origin coordinates; an explicit value wins. Distribute preserves the requested ID order and evenly spaces origins between explicit endpoints or the existing minimum/maximum. World layouts process parents before descendants so final requested world positions agree. Geometry-based alignment, animated bounds and camera occlusion require the renderer.

`transform.lookAt` uses world-space target/up and samples the node and animated ancestors at the supplied time. Model forward defaults to `+z`, and any of `+x/-x/+y/-y/+z/-z` may be specified. Its up vector is world `+y` by default; parallel forward/up directions and a coincident target fail instead of choosing an arbitrary rotation. World orientations are geometric and may use an equivalent canonical Euler representation; use local rotation fields for intentional multi-turn angles. World edits of animated channels require `write:"key"` so the requested pose is actually achieved. A non-position world edit may key all local TRS fields needed to preserve the other sampled world values.

## Sampling, limits and adapters

Sampling composes every parent's transform at the requested time and returns a world matrix. A world TRS is omitted when that matrix contains shear. Hidden state includes ancestors; visual opacity does not silence audio. Media source time, volume, optional spatial gain/pan and known GLB clip time come from shared Scene Core functions. Geometry/pivot dimensions and real decoded video frames are not inferred from JSON.

There are no 8-resource/24-instance/600-second/2400-keyframe/coordinate-size quotas. Validation retains schema structure, finite numbers, positive dimensions and scale, nonnegative times, reference validity, cycle prevention, scalar 0–1 values and monotonic Bezier time handles. Runtime memory, transport and decoder constraints belong to adapters and must report concrete failures rather than rewriting the document.

The persistence adapter owns document hashes, revisions, atomic file writes, idempotency and `expectedLockVersion`. A dry run executes exactly the same `apply` and skips persistence. Store and edit document schema 6; playback manifests 4/5/7/8 are compiled outputs and must not replace an authoring document.
