'use strict';
// Platform-independent clock and numeric transform sampling. Hosts own rendering,
// asset loading and frame scheduling; disposing a player releases every binding.
const CHANNELS = ['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale.x', 'scale.y', 'scale.z'];
const vector = a => ({ x: a[0], y: a[1], z: a[2] });
function instanceValues(instance) {
  return { position: vector(instance.position), rotation: vector(instance.rotation), scale: vector(instance.scale) };
}
function applyTransform(root, value) {
  root.position.set(value.position.x, value.position.y, value.position.z);
  root.rotation.set(value.rotation.x, value.rotation.y, value.rotation.z, 'XYZ');
  root.scale.set(value.scale.x, value.scale.y, value.scale.z);
}
const cubic = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
function sampleTrack(frames, time, fallback) {
  if (!frames || !frames.length) return fallback;
  if (time <= frames[0].time) return frames[0].value;
  let low = 0, high = frames.length;
  while (low < high) { const mid = (low + high) >>> 1; if (frames[mid].time <= time) low = mid + 1; else high = mid; }
  const left = frames[low - 1], right = frames[low];
  if (!right || time === left.time || !left.connectedRight) return left.value;
  const progress = (time - left.time) / (right.time - left.time);
  const x1 = left.handles[2], y1 = left.handles[3], x2 = right.handles[0], y2 = right.handles[1];
  let fraction = progress;
  if (x1 !== y1 || x2 !== y2) {
    let a = 0, b = 1;
    // Monotone x handles are validated on input. Bisection is stable even at
    // flat tangents and identical endpoints, without per-frame allocations.
    for (let i = 0; i < 32; i++) { const m = (a + b) / 2; if (cubic(m, x1, x2) < progress) a = m; else b = m; }
    fraction = cubic((a + b) / 2, y1, y2);
  }
  return left.value + (right.value - left.value) * fraction;
}
function sampleInstance(instance, time) {
  const value = instanceValues(instance);
  for (const channel of CHANNELS) {
    const [group, axis] = channel.split('.');
    value[group][axis] = sampleTrack(instance.tracks && instance.tracks[channel], time, value[group][axis]);
  }
  return value;
}
function clipTime(time, animation, duration) {
  const local = Math.max(0, time - animation.startSeconds);
  return duration > 0 ? (animation.loop ? local % duration : Math.min(local, duration)) : 0;
}
/** Shared entry/exit envelope; old untimed nodes retain their original visibility. */
function sampleFade(instance, time, sceneDuration = null) {
  const timing = instance.timing;
  if (!timing) return { visible: true, opacity: 1, localTime: Math.max(0, time) };
  const start = timing.startSeconds;
  const end = timing.endSeconds === null ? (sceneDuration === null ? Infinity : sceneDuration) : timing.endSeconds;
  const localTime = Math.max(0, time - start);
  const visible = time >= start && time < end;
  const fadeIn = timing.fadeInSeconds > 0 ? localTime / timing.fadeInSeconds : 1;
  const fadeOut = timing.fadeOutSeconds > 0 ? (end - time) / timing.fadeOutSeconds : 1;
  return { visible, opacity: visible ? Math.max(0, Math.min(1, fadeIn, fadeOut)) : 0, localTime };
}
const clampUnit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
function sampleOpacity(instance, time) {
  return clampUnit(sampleTrack(instance.tracks && instance.tracks.opacity, time, instance.opacity === undefined ? 1 : instance.opacity));
}
function sampleVolume(instance, time) {
  return clampUnit(sampleTrack(instance.tracks && instance.tracks.volume, time, instance.media && instance.media.volume !== undefined ? instance.media.volume : 1));
}
/** Opacity does not affect audibility; hosts apply sampleFade to audio independently. */
function samplePresentation(instance, time, sceneDuration = null) {
  const presentation = sampleFade(instance, time, sceneDuration);
  presentation.opacity *= sampleOpacity(instance, time);
  return presentation;
}
const finiteVector = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
/** Both positions and listener orientation are in the same world space, in meters. */
function sampleSpatialAudio(settings, source, listener) {
  if (!settings || !settings.enabled) return { gain: 1, pan: 0 };
  if (!finiteVector(source) || !listener || !finiteVector(listener.position) || !finiteVector(listener.forward) || !finiteVector(listener.up)) return { gain: 0, pan: 0 };
  const ref = Number.isFinite(settings.refDistance) && settings.refDistance > 0 ? settings.refDistance : 1;
  const max = Number.isFinite(settings.maxDistance) ? Math.max(ref, settings.maxDistance) : Math.max(ref, 30);
  const rolloff = Number.isFinite(settings.rolloffFactor) ? Math.max(0, settings.rolloffFactor) : 1;
  const dx = source.x - listener.position.x, dy = source.y - listener.position.y, dz = source.z - listener.position.z;
  const distance = Math.hypot(dx, dy, dz), boundedDistance = Math.max(ref, Math.min(max, distance));
  const gain = ref / (ref + rolloff * (boundedDistance - ref));
  // Camera right is forward × up, normalized independently of AR pose scale.
  const f = listener.forward, u = listener.up;
  const rx = f.y * u.z - f.z * u.y, ry = f.z * u.x - f.x * u.z, rz = f.x * u.y - f.y * u.x;
  const length = Math.hypot(rx, ry, rz);
  const pan = distance > 1e-8 && length > 1e-8 ? Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / (distance * length))) : 0;
  return { gain, pan };
}
/** Map scene seconds to source-media time at 1x, respecting trim and looping. */
function mediaTime(time, media = { trimStartSeconds: 0, trimEndSeconds: null, playbackRate: 1, loop: false }, timing, duration) {
  const sourceEnd = Number.isFinite(duration) && duration >= 0 ? duration : Infinity;
  const start = Math.min(sourceEnd, media.trimStartSeconds);
  const end = Math.max(start, Math.min(sourceEnd, media.trimEndSeconds === null ? Infinity : media.trimEndSeconds));
  const span = end - start;
  if (span <= 0) return start;
  const local = Math.max(0, time - (timing ? timing.startSeconds : 0));
  return start + (media.loop && Number.isFinite(span) ? local % span : Math.min(local, span));
}
const MEDIA_PRELOAD_SECONDS = 5, MEDIA_PRELOAD_UPCOMING_LIMIT = 2;
/** Pure preparation plan. Hosts supply only audio/video nodes and own all I/O. */
function mediaPreloadIds(instances, time, sceneDuration = null, loop = false) {
  const active = [], upcoming = [];
  for (const instance of instances) {
    const start = instance.timing ? instance.timing.startSeconds : 0;
    const end = Math.min(instance.timing && instance.timing.endSeconds !== null ? instance.timing.endSeconds : Infinity, sceneDuration === null ? Infinity : sceneDuration);
    if (start >= end) continue;
    if (samplePresentation(instance, time, sceneDuration).visible) { active.push(instance.id); continue; }
    const delay = start > time ? start - time : loop && sceneDuration > 0 ? sceneDuration - time + start : Infinity;
    if (delay >= 0 && delay <= MEDIA_PRELOAD_SECONDS) upcoming.push({ id: instance.id, delay });
  }
  upcoming.sort((a, b) => a.delay - b.delay);
  return active.concat(upcoming.slice(0, MEDIA_PRELOAD_UPCOMING_LIMIT).map(item => item.id));
}
// Groups and instances share one ID space; each node is sampled in its parent's space.
const nodeMap = content => new Map([...(content.groups || []), ...content.instances].map(node => [node.id, node]));
function createSceneCore({ content }) {
  let current = content, time = 0, playing = false, looping = !!content.loop, disposed = false;
  let instances = nodeMap(current);
  const listeners = new Set(), bindings = new Map();
  const duration = () => current.durationSeconds;
  const sample = id => { const instance = instances.get(id); return instance ? sampleInstance(instance, time) : undefined; };
  function emit() {
    if (disposed) return;
    for (const [id, callbacks] of bindings) { const value = sample(id); if (value) for (const callback of callbacks) callback(value); }
    for (const callback of listeners) callback();
  }
  const core = {
    get time() { return time; }, get playing() { return playing; }, get duration() { return duration(); }, get looping() { return looping; },
    sample,
    sync(next) {
      if (disposed) return;
      current = next; instances = nodeMap(next);
      for (const id of bindings.keys()) if (!instances.has(id)) bindings.delete(id);
      if (duration() !== null) time = Math.min(time, duration());
      if (duration() !== null && time >= duration()) playing = false;
      emit();
    },
    subscribe(callback) { if (disposed) return () => {}; listeners.add(callback); callback(); return () => listeners.delete(callback); },
    observe(id, callback) {
      if (disposed) return () => {};
      const value = sample(id); if (!value) throw new Error(`Unknown scene node: ${id}`);
      let callbacks = bindings.get(id); if (!callbacks) bindings.set(id, callbacks = new Set());
      callbacks.add(callback); callback(value);
      return () => { callbacks.delete(callback); if (!callbacks.size && bindings.get(id) === callbacks) bindings.delete(id); };
    },
    bind(id, root) { return core.observe(id, value => applyTransform(root, value)); },
    seek(position) { if (disposed || !Number.isFinite(position)) return; playing = false; time = Math.max(0, Math.min(duration() === null ? Infinity : duration(), position)); emit(); },
    pause() { if (disposed) return; playing = false; emit(); },
    play(loop = current.loop) { if (disposed) return; if (duration() !== null && time >= duration()) time = 0; looping = loop; playing = true; emit(); },
    advance(seconds) {
      if (disposed || !playing || !Number.isFinite(seconds) || seconds < 0) return;
      time += seconds;
      if (duration() !== null && time >= duration()) {
        if (looping) time %= duration(); else { time = duration(); playing = false; }
      }
      emit();
    },
    dispose() { disposed = true; playing = false; listeners.clear(); bindings.clear(); instances.clear(); current = { instances: [], durationSeconds: null, loop: false }; },
  };
  return core;
}
module.exports = { createSceneCore, instanceValues, applyTransform, clipTime, sampleTrack, sampleInstance, sampleFade, sampleOpacity, sampleVolume, samplePresentation, sampleSpatialAudio, mediaTime, mediaPreloadIds, MEDIA_PRELOAD_SECONDS, MEDIA_PRELOAD_UPCOMING_LIMIT };
