import assert from 'node:assert/strict';
import { createSceneCore, mediaPreloadIds, mediaTime, samplePresentation } from '@spatial-memory/scene-core';
import { fromDocument, toDocument } from '../app/manage/lib/scene-document';
import { compileSceneManifest, resourceKindIssues } from '../lib/scene/compile';
import { groupNodes, isGroup, removeNodes, trackRows } from '../lib/scene/hierarchy-authoring';
import { createBlankSceneDocument, type CompositionInstance, type InstanceMedia, type InstanceTiming } from '../lib/scene/protocol';
import { validateSceneDefinition, validateSceneDocument } from '../lib/scene/validate';

const timing: InstanceTiming = { startSeconds: 2, endSeconds: 8, fadeInSeconds: 1, fadeOutSeconds: 2 };
const media: InstanceMedia = { trimStartSeconds: 5, trimEndSeconds: 9, playbackRate: 1, loop: false, volume: .7, muted: false };
const title: CompositionInstance = { id: 'title', text: { content: '第一幕\nA story in space', color: '#ffffff', fontSize: .25, width: 3, align: 'center' }, timing, position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null };
const document = createBlankSceneDocument();
document.content.instances.push(title);
assert.equal(validateSceneDocument(document).ok, true);
assert.deepEqual(toDocument(fromDocument(JSON.parse(JSON.stringify(document)))), document, 'scene text survives save/reopen without an asset');
assert.deepEqual(document.content.assets, {});
assert.equal(isGroup(title), false, 'text is an ordinary timeline track');
const group = groupNodes(document.content, ['title'], { id: 'act', name: 'Act I' });
assert.ok(group.ok);
assert.deepEqual(trackRows(group.content).map(row => row.kind), ['group', 'instance']);
assert.deepEqual(removeNodes(group.content, ['act']).instances, []);

const textManifest = compileSceneManifest('scene', document, {});
assert.equal(textManifest.schemaVersion, 7);
assert.equal(validateSceneDefinition({ schemaVersion: 7, content: textManifest.content }).ok, true);
assert.equal(validateSceneDefinition({ schemaVersion: 4, content: textManifest.content }).ok, false, 'new fields cannot masquerade as an older playback protocol');
assert.equal(compileSceneManifest('scene', createBlankSceneDocument(), {}).schemaVersion, 4);
const mediaDoc = createBlankSceneDocument();
mediaDoc.content.assets.music = { assetId: '11111111-1111-4111-8111-111111111111' };
mediaDoc.content.instances = [{ id: 'music', asset: 'music', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null, media, timing }];
assert.equal(validateSceneDocument(mediaDoc).ok, true);
assert.deepEqual(resourceKindIssues(mediaDoc, { music: 'audio' }), []);
assert.ok(resourceKindIssues(mediaDoc, { music: 'model' }).length > 0);
assert.ok(resourceKindIssues(mediaDoc, { music: 'text' }).length > 0, 'team text assets remain distinct from scene text');
assert.equal(compileSceneManifest('scene', mediaDoc, { music: { assetId: mediaDoc.content.assets.music.assetId, url: 'https://fixture.invalid/a.mp3', kind: 'audio' } }).schemaVersion, 7);
const audioWithoutParameters = structuredClone(mediaDoc); delete audioWithoutParameters.content.instances[0].media; delete audioWithoutParameters.content.instances[0].timing;
assert.equal(compileSceneManifest('scene', audioWithoutParameters, { music: { assetId: mediaDoc.content.assets.music.assetId, url: 'https://fixture.invalid/a.mp3', kind: 'audio' } }).schemaVersion, 7, 'resource kind alone requires media-capable playback');

assert.deepEqual(samplePresentation(title, 1, 10), { visible: false, opacity: 0, localTime: 0 });
assert.deepEqual(samplePresentation(title, 2, 10), { visible: true, opacity: 0, localTime: 0 });
assert.equal(samplePresentation(title, 2.5, 10).opacity, .5);
assert.equal(samplePresentation(title, 5, 10).opacity, 1);
assert.equal(samplePresentation(title, 7, 10).opacity, .5);
assert.equal(samplePresentation(title, 8, 10).visible, false);
assert.equal(samplePresentation({}, 10, 10).visible, true, 'legacy untimed model remains visible at its final pose');
assert.equal(samplePresentation({ timing: { ...timing, endSeconds: null } }, 10, 10).visible, false);
assert.equal(samplePresentation({ timing: { ...timing, endSeconds: null } }, 100, null).visible, true);
assert.equal(mediaTime(1, media, timing, 20), 5);
assert.equal(mediaTime(3, media, timing, 20), 6);
assert.equal(mediaTime(4, media, timing, 20), 7);
assert.equal(mediaTime(99, media, timing, 20), 9);
assert.equal(mediaTime(6, { ...media, loop: true }, timing, 20), 5);
assert.equal(mediaTime(6.5, { ...media, loop: true }, timing, 20), 5.5);
assert.equal(mediaTime(9, media, timing, 3), 3, 'trim outside source duration stays at source end');
assert.equal(mediaTime(2, undefined, undefined, 3), 2);
assert.equal(mediaTime(9, undefined, undefined, 3), 3);
for (const playbackRate of [.1, 2, 8]) {
  assert.equal(Reflect.apply(mediaTime, undefined, [3, { ...media, playbackRate }, timing, 20]), 6, 'the runtime sampler never changes speed for stale input');
}

const cue = (id: string, startSeconds: number, endSeconds: number) => ({ id, timing: { startSeconds, endSeconds, fadeInSeconds: 0, fadeOutSeconds: 0 } });
const cues = [cue('late', 25, 29), cue('third', 4, 7), cue('second', 3, 6), cue('first', 2, 4), cue('now', 0, 1)];
assert.deepEqual(mediaPreloadIds(cues, 0, 30), ['now', 'first', 'second'], 'active cues and the nearest two within five seconds');
assert.deepEqual(mediaPreloadIds(cues, 3.5, 30), ['second', 'first', 'third'], 'overlapping active cues are never evicted by the speculative limit');
assert.deepEqual(mediaPreloadIds(cues, 8, 30), [], 'past and distant cues release their network and decoder resources');
assert.deepEqual(mediaPreloadIds(cues, 20, 30), ['late'], 'preload begins exactly five seconds before the cue');
assert.deepEqual(mediaPreloadIds(cues, 29, 30, true), ['now', 'first'], 'scene loops prepare the next iteration before wrapping');
assert.deepEqual(mediaPreloadIds(cues, 29, 30, false), []);
assert.deepEqual(mediaPreloadIds([cue('outside', 30, 35), cue('shortened', 32, 40)], 29, 30, true), [], 'cues beyond the shortened scene never request data');
assert.deepEqual(mediaPreloadIds([cue('unbounded', 10, 20)], 5, null), ['unbounded']);
const clock = createSceneCore({ content: { ...document.content, loop: true } });
assert.equal(clock.looping, true); clock.play(false); assert.equal(clock.looping, false); clock.pause(); assert.equal(clock.looping, false); clock.dispose();

for (const patch of [
  { asset: 'music' },
  { text: { ...title.text, content: '' } },
  { text: { ...title.text, color: 'url(javascript:evil)' } },
  { text: { ...title.text, align: ['left'] } },
  { text: { ...title.text, width: Infinity } },
  { text: { ...title.text, fontSize: 0 } },
  { timing: { ...timing, endSeconds: 2 } },
  { timing: { ...timing, fadeInSeconds: -1 } },
  { timing: { ...timing, startSeconds: NaN } },
  { media },
]) {
  const invalid = structuredClone(document);
  Object.assign(invalid.content.instances[0], patch);
  assert.equal(validateSceneDocument(invalid).ok, false, JSON.stringify(patch));
}
const longText = structuredClone(document);
longText.content.instances[0].text!.content = 'x'.repeat(4001);
assert.equal(validateSceneDocument(longText).ok, true, 'scene text has no arbitrary 4000-character quota');
for (const patch of [{ volume: 2 }, { playbackRate: 0 }, { playbackRate: 2 }, { playbackRate: .5 }, { trimStartSeconds: -1 }, { trimEndSeconds: 5 }, { muted: 'yes' }]) {
  const invalid = structuredClone(mediaDoc);
  Object.assign(invalid.content.instances[0].media!, patch);
  assert.equal(validateSceneDocument(invalid).ok, false);
}
console.log(JSON.stringify({ result: 'PASS', coverage: 'scene-owned text roundtrip and grouping, strict media/timing/text validation, authorized kind rules, protocol compatibility, entry/exit fades, media trimming/natural speed/loop/source clamping' }));
