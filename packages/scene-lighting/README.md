# Scene lighting

Shared Three.js rendering policy for the Web Scene Editor, local screenshot renderer,
and WeChat AR runtime. Scene Core remains independent of rendering.

All hosts pin Three.js **0.183.2**, use sRGB output, `NoToneMapping`, exposure 1,
disabled shadows and no MSAA. The built-in `RoomEnvironment` is converted to PMREM
with sigma 0.04 by the same code on each host. One rig owns and disposes one
environment render target; disabling the environment does not destroy the cached
texture. No environment URL, download, camera background or device light estimate
is part of this contract.

`content.lighting` is optional in document schema 6. When present, it must contain
all fields in `DEFAULT_SCENE_LIGHTING`; unknown keys, invalid colors, non-finite
numbers and out-of-range values are rejected by both server and mobile validator.
Explicit lighting compiles to playback schema **10**, including when a viewer
position is also present. Older documents use the same defaults on current hosts.

| Field | Range / values |
| --- | --- |
| `ambientColor`, `directionalColor` | `#RRGGBB` |
| `ambientIntensity`, `directionalIntensity` | 0–10 |
| `azimuth`, `environmentRotation` | −180–180 degrees |
| `elevation` | −90–90 degrees |
| `environment` | `studio`, `none` |
| `environmentIntensity` | 0–5 |

Light and environment directions are scene-local. `apply(settings, placement)`
rotates them with the placed scene and positions the directional-light target at
its world origin. `renderSceneContent` renders regular AR objects with defaults
and each Scene with its own rig settings, retaining the framebuffer and depth.
Scene visibility is restored in `finally`. Independent translucent scenes are
drawn far-to-near by root position; intersecting translucent geometry across
different Scenes still has the usual object-sorting limitation.

Update the pinned mini-program package and generated renderer together:

```sh
npm pack ./packages/scene-lighting --pack-destination ../spatial-memory-mini-program/vendor
cd ../spatial-memory-mini-program
npm install --ignore-scripts ./vendor/spatial-memory-scene-lighting-1.0.0.tgz
npm run build:xr-three-lab
npm test
```

Web `npm run test:cross-runtime` includes GPU pixel comparisons of the actual
Web renderer and bundled mini renderer, metallic/rough materials, lighting and
environment controls, and rotated AR placement. The browser fixture holds GPU,
camera projection and resolution constant. Real-device camera images, optics,
display color and native decoding remain device-dependent and require phone
acceptance; matching shader output is not a claim of identical camera backgrounds.
