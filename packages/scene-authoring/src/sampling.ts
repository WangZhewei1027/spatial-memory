import { Vector3 } from 'three';
import { decompose, localAt, worldMatrices } from './math';
import { clipTime, mediaTime, samplePresentation, sampleFade, sampleVolume, sampleSpatialAudio } from '@spatial-memory/scene-core';
import type { SceneDocument } from './protocol';
import { catchResult, finite, isInstance, nodes, selected, success } from './common';
import { validate } from './validation';
import type { AuthoringOptions, ResourceFact, Result, SampleOptions, SampledNode, SceneInspection, SceneNode, SceneSample } from './types';

export function resourceFor(document: SceneDocument, node: SceneNode, options: AuthoringOptions): ResourceFact | undefined {
  if (!isInstance(node) || !node.asset) return undefined;
  return options.resources?.[document.content.assets[node.asset]?.assetId];
}
export function regionOf(document: SceneDocument, node: SceneNode, options: AuthoringOptions = {}): { start: number; end: number | null } {
  if (!isInstance(node)) {
    const ranges = selected(document, [node.id], true).filter(isInstance).map(item => regionOf(document, item, options));
    if (!ranges.length) return { start: 0, end: document.content.durationSeconds };
    return { start: Math.min(...ranges.map(range => range.start)), end: ranges.some(range => range.end === null) ? null : Math.max(...ranges.map(range => range.end!)) };
  }
  const start = node.timing?.startSeconds ?? node.animation?.startSeconds ?? 0;
  if (node.timing) return { start, end: node.timing.endSeconds ?? document.content.durationSeconds };
  const resource = resourceFor(document, node, options);
  if (node.animation && !node.animation.loop) {
    const animation = node.animation, clip = resource?.animations?.find(item => animation.clipIndex !== undefined ? item.index === animation.clipIndex : item.name === animation.clipName);
    if (clip?.duration !== undefined) return { start, end: start + clip.duration };
  }
  if ((node.media || resource?.kind === 'audio' || resource?.kind === 'video') && !node.media?.loop) {
    const end = node.media?.trimEndSeconds ?? resource?.durationSeconds;
    if (end !== undefined && end !== null) return { start, end: start + Math.max(0, end - (node.media?.trimStartSeconds ?? 0)) };
  }
  return { start, end: document.content.durationSeconds };
}
export function sample(document: unknown, input: number | SampleOptions): Result<{ sample: SceneSample }> {
  return catchResult(() => {
    const options: SampleOptions = typeof input === 'number' ? { time: input } : input;
    const valid = validate(document, options); if (!valid.ok) return valid;
    const time = finite(options.time, 'time', 0), content = valid.document.content;
    const matrices = worldMatrices(valid.document, time), byId = new Map(nodes(valid.document).map(node => [node.id, node]));
    const wanted = options.nodeIds ? selected(valid.document, options.nodeIds) : [...byId.values()];
    const result: Record<string, SampledNode> = {};
    for (const node of wanted) {
      let hidden = false;
      for (let at: SceneNode | undefined = node; at; at = at.parent ? byId.get(at.parent) : undefined) if (at.hidden) { hidden = true; break; }
      const matrix = matrices.get(node.id)!, world = decompose(matrix);
      const presentation = isInstance(node) ? samplePresentation(node, time, content.durationSeconds) : { visible: true, opacity: 1 };
      const item: SampledNode = { id: node.id, kind: isInstance(node) ? 'instance' : 'group', parentId: node.parent ?? null,
        local: localAt(node, time), worldMatrix: matrix.toArray(), ...(world ? { world } : {}), hidden,
        visible: !hidden && presentation.visible && presentation.opacity > 0, opacity: hidden ? 0 : presentation.opacity };
      if (isInstance(node)) {
        const fact = resourceFor(valid.document, node, options);
        if (node.media || fact?.kind === 'audio' || fact?.kind === 'video') {
          item.mediaTime = mediaTime(time, node.media, node.timing, fact?.durationSeconds ?? undefined);
          const spatial = node.media?.spatial;
          if (spatial?.enabled && options.listener) item.spatial = sampleSpatialAudio(spatial, new Vector3().setFromMatrixPosition(matrix), options.listener);
          // hidden/visual opacity never silences a video; only fades, volume and mute do.
          item.volume = node.media?.muted ? 0 : sampleVolume(node, time) * sampleFade(node, time, content.durationSeconds).opacity * (item.spatial?.gain ?? 1);
        }
        if (node.animation) {
          const animation = node.animation, clip = fact?.animations?.find(value => animation.clipIndex !== undefined ? value.index === animation.clipIndex : value.name === animation.clipName);
          if (clip?.duration !== undefined) item.clipTime = clipTime(time, animation, clip.duration);
        }
      }
      result[node.id] = item;
    }
    return success({ sample: { time, durationSeconds: content.durationSeconds, nodes: result } }, valid.warnings);
  });
}
export function inspect(document: unknown, options: AuthoringOptions = {}): Result<{ inspection: SceneInspection }> {
  return catchResult(() => {
    const valid = validate(document, options); if (!valid.ok) return valid;
    const content = valid.document.content, all = nodes(valid.document);
    let keyframes = 0, channels = 0;
    for (const node of all) for (const keys of Object.values(node.tracks ?? {})) { channels++; keyframes += keys.length; }
    return success({ inspection: {
      schemaVersion: 6, units: 'meters', durationSeconds: content.durationSeconds, loop: content.loop,
      counts: { assets: Object.keys(content.assets).length, instances: content.instances.length, groups: content.groups?.length ?? 0, keyframes, channels },
      assets: Object.entries(content.assets).map(([alias, ref]) => ({ alias, assetId: ref.assetId, ...(options.resources?.[ref.assetId] ? { kind: options.resources[ref.assetId].kind } : {}), instanceIds: content.instances.filter(node => node.asset === alias).map(node => node.id) })),
      nodes: all.map(node => ({ id: node.id, kind: isInstance(node) ? 'instance' : 'group', ...(node.name !== undefined ? { name: node.name } : {}), parentId: node.parent ?? null, childIds: all.filter(child => child.parent === node.id).map(child => child.id), channels: Object.keys(node.tracks ?? {}), region: regionOf(valid.document, node, options), hidden: !!node.hidden })),
      capabilities: { geometryBounds: false, occlusion: false },
    } }, valid.warnings);
  });
}
