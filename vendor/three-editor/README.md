# Embedded Three.js Editor r183

Source: https://github.com/mrdoob/three.js/tree/r183/editor (MIT, see LICENSE).
The upstream editor is not distributed as a reusable npm component. This directory vendors the small source closure used by our existing scene route, against the installed Three 0.183.2. JS Signals 1.0.0 is the upstream editor's MIT dependency and retains its header.

Used upstream modules: Editor, Selector, Viewport, EditorControls, ViewHelper, ViewportControls, Toolbar, UI, Strings and native position/rotation/scale commands. No independent scene format or player is introduced.

`integration.patch` records every modification to the upstream files; `integrity.json` records both upstream and embedded SHA-256 values. `index.js`/`index.d.ts` are the local export/type boundary. To update, fetch the listed files from the new official tag, review/reapply the patch, update the hashes and run the scene regressions plus browser acceptance. Never replace the tag with an unpinned live editor URL.

Integration changes:

- Inject in-memory configuration and host command handling. Disable the editor's standalone Loader, IndexedDB and History imports. Our asset library owns imports, the existing scene API owns persistence, and the host scene document owns transform undo in a single history capped at 60 past snapshots. Native standalone JSON import/export menus are not mounted.
- Import the bundled Signal module explicitly instead of requiring a window global. Defer the unused download link allocation until export is called.
- Omit standalone WebXR/path tracing and the `realistic` option; keep the native solid/normals/wireframe viewport modes. Only the existing asset-instance transforms and GLB clips belong to the shared playback contract.
- Expose `beforeRender`, transform/editability, helper position and `dispose` hooks. Shared Core supplies the animation poses; the native viewport renders them. Explicitly release the renderer, controls, helpers, frame loop, theme/pointer listeners and PMREM resources on unmount, including a mid-drag exit. Dispose replacement override materials.
- Expose the native camera/shading control panel so it can sit in the existing left sidebar. Set toolbar image URLs under `/three-editor/` and accessible names on buttons/selects. Outer CSS scopes their layout.
- The view helper's transparent 128 px panel no longer intercepts the pointer. A capture listener claims only presses on an axis button, so transform gizmo handles and orbit drags behind the panel still reach the canvas.
- Allow the host to pin `viewport/theme` to `dark` or `light`, using upstream clear/grid colors instead of following the OS theme. This is editor appearance only, not a persisted scene background.

`app/manage/scenes/components/three-editor/` is the adapter: instance-level selection, one host-document commit per completed native transform drag, reference-counted GLB templates, clip sampling and React lifecycle. Numeric tracks and the viewport share the dependency-free Scene Core; the host owns undo and displays Euler XYZ rotation in degrees while storing radians. GLB internals remain immutable assets; arbitrary Three editor materials, lights, hierarchy reparenting, scripting and JSON projects are not part of this first integration and have no editable menus.

Checks: `npx tsx scripts/test-three-editor.ts` covers native command ownership, instance protection and 100 GLB load/dispose cycles; `npx tsx scripts/test-scene-playback-parity.ts` compares this adapter with the actual mini-program player. Run `npm run check` for the Web regression suite. Current browser acceptance and its limits are recorded in `docs/scene-asset.md`.
