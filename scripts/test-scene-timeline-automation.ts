import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleChannel, setKey, moveKeys } from '../lib/scene/transform-authoring';
import type { CompositionInstance } from '../lib/scene/protocol';
import { keyAll, unkeyAll } from '../lib/scene/transform-authoring';
import { interpolationOf, setInterpolation, type KeySelection } from '../app/manage/scenes/components/timeline-keys';

const instance: CompositionInstance = { id: 'video', asset: 'video', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null, opacity: .75,
  media: { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, volume: .6, muted: false, loop: false } };

test('timeline scalar actions use sampled values and preserve independent channels through curve edits, drag and delete', () => {
  let node = keyAll(instance, ['opacity', 'volume'], 0);
  node = setKey(setKey(node, 'opacity', 2, .25), 'volume', 2, .2);
  node = keyAll(node, ['opacity', 'volume'], 1);
  assert.equal(node.tracks?.opacity?.find(frame => frame.time === 1)?.value, .5);
  assert.ok(Math.abs(node.tracks!.volume!.find(frame => frame.time === 1)!.value - .4) < 1e-10);
  const key: KeySelection = { nodeId: node.id, channels: ['volume'], time: 0 };
  const held = setInterpolation(node, key, 'hold');
  assert.equal(interpolationOf(held, key), 'hold');
  assert.equal(sampleChannel(held, 'volume', .5), .6);
  assert.equal(sampleChannel(held, 'opacity', .5), .625);
  const moved = moveKeys(held, ['volume'], 1, 1.5);
  assert.deepEqual(moved.tracks?.volume?.map(frame => frame.time), [0, 1.5, 2]);
  assert.deepEqual(moved.tracks?.opacity?.map(frame => frame.time), [0, 1, 2]);
  assert.equal(interpolationOf(setInterpolation(moved, key, 'ease'), key), 'ease');
  assert.equal(interpolationOf(setInterpolation(moved, key, 'linear'), key), 'linear');
  const unkeyed = unkeyAll(keyAll(instance, ['opacity', 'volume'], 1), ['opacity', 'volume'], 1);
  assert.equal(unkeyed.tracks?.opacity, undefined);
  assert.equal(unkeyed.tracks?.volume, undefined);
  assert.equal(sampleChannel(unkeyed, 'opacity', 9), .75);
  assert.equal(sampleChannel(unkeyed, 'volume', 9), .6);
});


test('keyframe controls reject a selection belonging to a different track', () => {
  const node = setKey(setKey(instance, 'volume', 0, .6), 'volume', 2, .2);
  const staleKey: KeySelection = { nodeId: 'previous-audio-track', channels: ['volume'], time: 0 };
  assert.equal(interpolationOf(node, staleKey), null, 'a previous track cannot populate the current curve control');
  assert.equal(setInterpolation(node, staleKey, 'hold'), node, 'stale selection cannot change another track');
  assert.ok(Math.abs(sampleChannel(node, 'volume', 1) - .4) < 1e-10);
});
