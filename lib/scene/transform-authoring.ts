import { sampleInstance, sampleOpacity, sampleVolume, type Vector } from '@spatial-memory/scene-core';
import type { AutomationChannel, InstanceMedia, TransformKeyframe, TransformNode } from './protocol';
/** Instances and groups share the same transform authoring. */
type Node = Omit<TransformNode, 'tracks'> & { id: string; animation?: unknown; opacity?: number; media?: InstanceMedia; tracks?: Partial<Record<AutomationChannel, TransformKeyframe[]>> };
const scalar = (channel: AutomationChannel) => channel === 'opacity' || channel === 'volume';
/** Shared sampled value for scalar and transform controls. Groups remain transform-only. */
export function sampleChannel(node: Node, channel: AutomationChannel, time: number): number {
  if (channel === 'opacity') return sampleOpacity(node, time);
  if (channel === 'volume') return sampleVolume(node, time);
  const [group, axis] = channel.split('.') as [TransformGroup, 'x' | 'y' | 'z'];
  return sampleInstance(node, time)[group][axis];
}
export type TransformGroup = 'position' | 'rotation' | 'scale';
export const frameAt = (frames: TransformKeyframe[] | undefined, time: number) => frames?.findIndex(f => Math.abs(f.time - time) < 0.0005) ?? -1;
export const roundTime = (time: number) => Math.round(time * 1000) / 1000;
export function setKey<N extends Node>(instance: N, channel: AutomationChannel, time: number, value: number): N {
  if (scalar(channel) && !('animation' in instance)) return instance;
  const frames = [...(instance.tracks?.[channel] ?? [])];
  const index = frameAt(frames, time);
  const frame: TransformKeyframe = index >= 0 ? { ...frames[index], value } : { time: roundTime(time), value, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3], connectedRight: true };
  if (index >= 0) frames[index] = frame; else frames.push(frame);
  frames.sort((a, b) => a.time - b.time);
  return { ...instance, tracks: { ...instance.tracks, [channel]: frames } };
}
export function editChannel<N extends Node>(instance: N, channel: AutomationChannel, time: number, value: number): N {
  if (scalar(channel) && !('animation' in instance)) return instance;
  if (instance.tracks?.[channel]?.length) return setKey(instance, channel, time, value);
  if (channel === 'opacity') return { ...instance, opacity: value };
  if (channel === 'volume') return { ...instance, media: { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, loop: false, muted: false, ...instance.media, volume: value } };
  const [group, axis] = channel.split('.') as [TransformGroup, 'x' | 'y' | 'z'];
  const tuple = [...instance[group]] as [number, number, number]; tuple['xyz'.indexOf(axis)] = value;
  return { ...instance, [group]: tuple };
}
export function editTransform<N extends Node>(instance: N, group: TransformGroup, time: number, value: Vector): N {
  for (const axis of ['x', 'y', 'z'] as const) instance = editChannel(instance, `${group}.${axis}`, time, value[axis]);
  return instance;
}
export function removeKey<N extends Node>(instance: N, channel: AutomationChannel, time: number): N {
  const tracks = { ...instance.tracks };
  const frames = tracks[channel]?.filter(f => Math.abs(f.time - time) >= 0.0005) ?? [];
  if (frames.length) tracks[channel] = frames;
  else delete tracks[channel];
  // Removing the final key keeps its visible pose as the new static value.
  const result = editChannel({ ...instance, tracks }, channel, time, sampleChannel(instance, channel, time));
  return frames.length ? { ...instance, tracks } : result;
}

/** Key a parameter as one edit, sampling each axis before any channel is changed. */
export const keyAll = <N extends Node>(node: N, channels: readonly AutomationChannel[], time: number): N => channels.reduce((next, channel) => setKey(next, channel, time, sampleChannel(node, channel, time)), node);
export const unkeyAll = <N extends Node>(node: N, channels: readonly AutomationChannel[], time: number): N => channels.reduce((next, channel) => frameAt(next.tracks?.[channel], time) >= 0 ? removeKey(next, channel, time) : next, node);

/** Key times across the given channels, merged within the keyframe tolerance. */
export function keyTimes(node: Pick<Node, 'tracks'>, channels: readonly AutomationChannel[]) {
  const times: number[] = [];
  for (const channel of channels) for (const frame of node.tracks?.[channel] ?? []) if (!times.some(time => Math.abs(time - frame.time) < 0.0005)) times.push(frame.time);
  return times.sort((a, b) => a - b);
}
/** Retime every listed channel's key at `from`; refuses when a channel already has a key at `to`. */
export function moveKeys<N extends Node>(node: N, channels: readonly AutomationChannel[], from: number, to: number): N {
  if (channels.some(channel => frameAt(node.tracks?.[channel], from) >= 0 && frameAt(node.tracks?.[channel], to) >= 0)) return node;
  const tracks = { ...node.tracks };
  for (const channel of channels) {
    const frames = tracks[channel], index = frameAt(frames, from);
    if (!frames || index < 0) continue;
    const next = [...frames]; next[index] = { ...next[index], time: roundTime(to) }; next.sort((a, b) => a.time - b.time);
    tracks[channel] = next;
  }
  return { ...node, tracks };
}
