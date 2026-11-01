import { createBlankSceneDocument, type CompositionInstance, type TransformKeyframe } from '../../lib/scene/protocol';

/** A valid document crossing every retired composition budget. No remote resources. */
export function unboundedScene() {
  const document = createBlankSceneDocument();
  const content = document.content;
  content.durationSeconds = 100_000;
  content.assets = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`asset_${i}`, { assetId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }]));
  content.groups = Array.from({ length: 20 }, (_, i) => ({ id: `group_${i}`, name: 'Group'.repeat(30), ...(i ? { parent: `group_${i - 1}` } : {}), position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }));
  content.instances = Array.from({ length: 25 }, (_, i): CompositionInstance => ({ id: `object_${i}`, name: 'Object'.repeat(30), asset: `asset_${i % 10}`, position: [10_000, -10_000, 0], rotation: [1000, -1000, 0], scale: [.00001, 1000, 1], animation: null }));
  const key = (time: number, value: number): TransformKeyframe => ({ time, value, handles: [.1, -200, .9, 200], connectedRight: true });
  Object.assign(content.instances[0], {
    parent: 'group_19',
    timing: { startSeconds: 700, endSeconds: 99_999, fadeInSeconds: 1000, fadeOutSeconds: 1000 },
    media: { trimStartSeconds: 90_000, trimEndSeconds: 99_999, playbackRate: 1, volume: 1, loop: true, muted: false, spatial: { enabled: true, refDistance: 200, maxDistance: 20_000, rolloffFactor: 20 } },
    tracks: { 'position.x': Array.from({ length: 2401 }, (_, i) => key(i, 10_000 + i)) },
  });
  const { asset: _asset, ...text } = content.instances[24];
  content.instances[24] = { ...text, text: { content: 'x'.repeat(1024 * 1024 + 1), color: '#ffffff', fontSize: .001, width: 200, align: 'left' } };
  return document;
}
