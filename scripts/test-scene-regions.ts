import assert from 'node:assert/strict';
import { applyRegion, changeRegion, instanceRegion } from '@/app/manage/scenes/components/scene-region';
import type { CompositionInstance } from '@/lib/scene/protocol';

const model: CompositionInstance = { id: 'model', asset: 'tree', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null };
assert.deepEqual(instanceRegion(model, 12), { start: 0, end: 12 }, 'static objects have a full-scene region');
const text: CompositionInstance = { ...model, asset: undefined, text: { content: 'Hello', color: '#ffffff', fontSize: .3, width: 3, align: 'center' }, timing: { startSeconds: 2, endSeconds: 7, fadeInSeconds: 1, fadeOutSeconds: 1 } };
assert.deepEqual(instanceRegion(text, 12), { start: 2, end: 7 }, 'text uses its scene-owned visibility interval');
assert.deepEqual(instanceRegion({ ...text, timing: { ...text.timing!, endSeconds: null } }, 12), { start: 2, end: 12 }, 'an open end follows the scene duration');

const range = { start: 2, end: 7 };
assert.deepEqual(changeRegion(range, 'move', -10), { start: 0, end: 5 }, 'moving before zero preserves length');
assert.deepEqual(changeRegion(range, 'move', 599), { start: 599, end: 604 }, 'moves preserve length beyond the former duration cap');
assert.deepEqual(changeRegion(range, 'start', 10), { start: 6.999, end: 7 }, 'start trim cannot invert a region');
assert.deepEqual(changeRegion(range, 'end', -1), { start: 2, end: 2.001 }, 'end trim retains a nonzero region');
assert.deepEqual(changeRegion(range, 'end', 700), { start: 2, end: 700 }, 'end trim supports long performances');
assert.equal(changeRegion(range, 'move', NaN), range, 'non-finite input is ignored');

const moved = applyRegion(text, range, changeRegion(range, 'move', 4), 'move');
assert.deepEqual(moved.timing, { startSeconds: 4, endSeconds: 9, fadeInSeconds: 1, fadeOutSeconds: 1 });
assert.equal(moved.text, text.text, 'timeline edits keep text content and ownership unchanged');
assert.deepEqual(text.timing, { startSeconds: 2, endSeconds: 7, fadeInSeconds: 1, fadeOutSeconds: 1 }, 'original snapshot remains intact for undo');
assert.equal(applyRegion(text, range, range, 'move'), text, 'a click without movement is a no-op');

const animated: CompositionInstance = { ...model, animation: { clipIndex: 0, startSeconds: 1, loop: false } };
assert.deepEqual(instanceRegion(animated, 12, 3), { start: 1, end: 4 }, 'legacy GLB region remains the clip duration');
const shifted = applyRegion(animated, { start: 1, end: 4 }, { start: 3, end: 6 }, 'move');
assert.deepEqual(shifted.animation, { clipIndex: 0, startSeconds: 3, loop: false });
assert.equal(shifted.timing, undefined, 'moving a legacy clip does not change its visibility semantics');
const trimmed = applyRegion(animated, { start: 1, end: 4 }, { start: 1, end: 3 }, 'end');
assert.equal(trimmed.timing?.endSeconds, 3, 'resizing a legacy clip introduces an explicit disappearance point');

const faded = applyRegion(text, range, { start: 2, end: 2.5 }, 'end');
assert.ok(faded.timing!.fadeInSeconds <= .5 && faded.timing!.fadeOutSeconds <= .5, 'shortening a region keeps each fade within its interval');
const nearLimit = applyRegion({ ...animated, animation: { ...animated.animation!, startSeconds: 599 }, timing: text.timing }, range, { start: 12, end: 17 }, 'move');
assert.equal(nearLimit.animation?.startSeconds, 609, 'moving a region preserves the independently offset GLB clip');
console.log('PASS performance region timing, movement, trimming, text ownership, legacy clips and undo snapshots');
