# Scene Core

Dependency-free transform sampling and playback shared by Web and WeChat. The host owns
rendering, assets and frame scheduling. Each `createSceneCore({content})` call creates an
independent player, without a global registry, DOM, timers, RAF or dynamic code execution.

`position`, Euler XYZ `rotation` (radians) and `scale` use optional numeric tracks. Each key
has a time, value, incoming/outgoing Bezier handles and `connectedRight` (false holds until
the next key). Linear handles produce linear interpolation. Exact keys return exact values.
No tracks means the instance's static transform. The editor displays rotation in degrees.
Optional `groups` share the instance ID space and are sampled the same way; values are local
to the parent group, and hosts build the Object3D hierarchy from each node's `parent`.

Use `play`, `pause`, `seek`, `advance(seconds)`, `sync(content)`, `sample(id)` and
`bind(id, object3D)`. `dispose` stops playback and clears all callbacks and object bindings.
GLB clips remain Three.AnimationMixer's responsibility; `clipTime` shares their time mapping.
`samplePresentation(instance, time, sceneDuration)` supplies timed visibility and the shared
fade envelope multiplied by the instance opacity. `sampleFade` returns the timing envelope
without opacity, so transparent video can still be audible. `sampleOpacity` and `sampleVolume`
sample optional scalar tracks with static `opacity` / `media.volume` fallbacks (default 1);
Bezier overshoot is clamped to [0, 1]. Groups remain transform-only. `mediaTime(time, settings, timing, sourceDuration)` maps scene time to trimmed,
rate-adjusted, optionally looping source-media seconds. Untimed legacy nodes stay visible at
the final scene time. `mediaPreloadIds(mediaInstances, time, sceneDuration, loop)` selects
all current cues and the nearest two upcoming cues within five scene seconds, including
loop wrap. Pass only audio/video nodes; the hosts prepare remote streams for these IDs
and release them when they leave the window. `core.looping` reports the selected loop
mode, including a `play(loop)` override. These helpers do not fetch or play media.
Scene documents must pass the server validator before playback. Audio rendering, script execution,
editor undo, asset fetch and AR tracking are intentionally outside this small package.

`sampleSpatialAudio(settings, source, listener)` computes distance gain and left/right pan.
Positions use the same world space in meters; the listener contains `position`, `forward`
and `up` vectors. An enabled source uses inverse attenuation clamped between `refDistance`
and `maxDistance`, with `rolloffFactor` controlling the decay. Camera right is forward × up.
Hosts apply gain to audio and pan when their audio API supports it; the core never opens
an audio context or converts local transforms to world coordinates.

Performance scenes compile to playback schema 7; opacity, scalar tracks or spatial audio
require schema 8. Both current adapters render scene-owned
text, images, video and audio using the same timing/fade/media mapping. The mini-program
owns native decoding and cleanup in `lib/scene-runtime/media*`; updating the clock snapshot
alone is not a player upgrade. Deploy the matching mini-program before enabling these
features for existing mobile clients. Legacy model scenes retain schema 4/5 and sampling.

Update the mini-program snapshot from the Web repository:

```sh
npm pack ./packages/scene-core --pack-destination ../spatial-memory-mini-program/vendor
cd ../spatial-memory-mini-program
npm install --ignore-scripts ./vendor/spatial-memory-scene-core-2.4.0.tgz
npm run build:scene-core
npm run test:scene-memory
```

Web `scripts/test-scene-playback-parity.ts` compares the actual Web adapter and mini player,
including GLB animation matrices. `scripts/test-scene-performance-parity.ts` also compares
actual surface transforms, text layout, fade materials and native audio state across adapters. Migration fixtures preserve samples from the retired
engine; live runtime and authoring never load that dependency or its document format.
