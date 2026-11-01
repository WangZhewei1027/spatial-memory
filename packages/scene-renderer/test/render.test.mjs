import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { probeAsset, renderScene } from '../dist/index.js';

const instance = (id, extra = {}) => ({ id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null, ...extra });
const document = instances => ({ schemaVersion: 6, content: { kind: 'composition', units: 'meters', durationSeconds: 10, loop: false, assets: {}, instances } });
function triangleGlb(positions = [-.5, 0, 0, .5, 0, 0, 0, 1, 0]) {
  const vertices = Buffer.from(new Float32Array(positions).buffer);
  const min = [0, 1, 2].map(axis => Math.min(...positions.filter((_, index) => index % 3 === axis)));
  const max = [0, 1, 2].map(axis => Math.max(...positions.filter((_, index) => index % 3 === axis)));
  let json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: vertices.length }], bufferViews: [{ buffer: 0, byteLength: vertices.length }], accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max }] });
  json += ' '.repeat((4 - json.length % 4) % 4);
  const result = Buffer.alloc(28 + json.length + vertices.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); result.write(json, 20);
  result.writeUInt32LE(vertices.length, 20 + json.length); result.writeUInt32LE(0x004e4942, 24 + json.length); vertices.copy(result, 28 + json.length);
  return result;
}

test('real editor snapshots expose clipping, corrective edits, stable image artifacts and samples', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-render-test-'));
  try {
    const text = { content: 'Scene harness', color: '#103db0', fontSize: .3, width: 1, align: 'center' };
    const doc = document([instance('title', { position: [5, .8, 0], text })]);
    const before = await renderScene({ document: doc, times: [0], cameras: ['audience'], outputDir: join(directory, 'before'), options: { width: 320, height: 480 } });
    assert.equal(before.frames[0].nodes.title.inFrustum, false);
    doc.content.instances[0].position[0] = 0;
    const after = await renderScene({ document: doc, times: [0, 2], cameras: ['audience'], outputDir: join(directory, 'after'), options: { width: 320, height: 480 } });
    assert.equal(after.frames[0].nodes.title.inFrustum, true);
    assert.notEqual(before.documentHash, after.documentHash);
    assert.notEqual(before.images[0].sha256, after.images[0].sha256);
    assert.equal(after.images[0].sha256, after.images[1].sha256, 'paused static scene is reproducible');
    assert.equal(after.frames[1].time, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('image probe waits for the actual texture and reports source dimensions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-probe-test-'));
  try {
    const image = join(directory, 'image.png');
    const sharp = (await import('sharp')).default;
    await sharp({ create: { width: 80, height: 40, channels: 3, background: '#e46324' } }).png().toFile(image);
    const result = await probeAsset({ path: image, outputDir: join(directory, 'probe') });
    assert.equal(result.facts.width, 80); assert.equal(result.facts.height, 40);
    assert.deepEqual(result.facts.bounds.size, [2, 1, 0]);
    assert.equal(result.previews.length, 1); assert.equal(result.errors.length, 0);
    await assert.rejects(probeAsset({ path: join(directory, 'missing.glb'), outputDir: join(directory, 'missing') }), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('video snapshots wait for the requested decoded frame rather than metadata alone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-video-test-'));
  try {
    const video = join(directory, 'sample.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=128x96:rate=10:duration=2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', video]);
    const doc = document([instance('video', { asset: 'video' })]);
    doc.content.assets.video = { assetId: '00000000-0000-4000-8000-000000000001' };
    const rendered = await renderScene({ document: doc, resources: { video: { kind: 'video', url: video } }, times: [0, 1], cameras: ['front'], outputDir: join(directory, 'frames'), options: { width: 320, height: 240 } });
    assert.ok(Math.abs(rendered.frames[1].nodes.video.media.actualSourceTime - 1) < .12);
    assert.equal(rendered.frames[1].nodes.video.media.requestedSourceTime, 1);
    assert.notEqual(rendered.images[0].sha256, rendered.images[1].sha256);
    await writeFile(join(directory, 'invalid.glb'), 'not a model');
    await assert.rejects(probeAsset({ path: join(directory, 'invalid.glb'), outputDir: join(directory, 'bad'), options: { timeoutMs: 3000 } }), /load|JSON|model/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('model probe returns actual geometry and missing clips fail instead of rendering a static substitute', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-model-test-'));
  try {
    const file = join(directory, 'triangle.glb'); await writeFile(file, triangleGlb());
    const probe = await probeAsset({ path: file, outputDir: join(directory, 'probe') });
    assert.deepEqual(probe.facts.bounds.size, [1, 1, 0]); assert.equal(probe.facts.triangles, 1);
    const doc = document([instance('model', { asset: 'model', animation: { clipIndex: 0, startSeconds: 0, loop: false } })]);
    doc.content.assets.model = { assetId: '00000000-0000-4000-8000-000000000001' };
    await assert.rejects(renderScene({ document: doc, resources: { model: { kind: 'model', url: file } }, times: [0], outputDir: join(directory, 'invalid') }), /Animation clip/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('model dependencies are checked from content, including GLB and extensionless files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-dependencies-test-'));
  try {
    const json = JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'https://example.test/texture.png' }] });
    const padded = Buffer.from(json + ' '.repeat((4 - json.length % 4) % 4));
    const glb = Buffer.alloc(20 + padded.length);
    glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
    for (const [name, bytes] of [['asset', json], ['asset.glb', glb]]) {
      const file = join(directory, name); await writeFile(file, bytes);
      await assert.rejects(probeAsset({ path: file, kind: 'model', outputDir: join(directory, `${name}-preview`) }), /MISSING_DEPENDENCIES.*texture\.png/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('resource hashes reject invalid syntax and stale bytes before browser rendering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-resource-hash-'));
  try {
    const file = join(directory, 'triangle.glb'); await writeFile(file, triangleGlb());
    const doc = document([instance('model', { asset: 'model' })]);
    doc.content.assets.model = { assetId: '00000000-0000-4000-8000-000000000001' };
    for (const [contentHash, expected] of [['invalid', /Invalid resource SHA256/], ['0'.repeat(64), /Resource changed since inspection/]]) {
      await assert.rejects(renderScene({ document: doc, resources: { model: { kind: 'model', url: file, contentHash } }, times: [0], outputDir: join(directory, contentHash) }), expected);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('camera fit contains every cube corner in square and extreme portrait/landscape views', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-camera-fit-'));
  try {
    const corners = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 1, -.5], [-.5, 1, -.5], [-.5, 0, .5], [.5, 0, .5], [.5, 1, .5], [-.5, 1, .5]];
    const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
    const file = join(directory, 'cube.glb'); await writeFile(file, triangleGlb(indices.flatMap(index => corners[index])));
    const doc = document([instance('cube', { asset: 'cube' })]);
    doc.content.assets.cube = { assetId: '00000000-0000-4000-8000-000000000001' };
    for (const [width, height] of [[320, 320], [160, 640], [640, 160]]) {
      const rendered = await renderScene({ document: doc, resources: { cube: { kind: 'model', url: file } }, times: [0], cameras: ['front', 'top', 'side'], outputDir: join(directory, `${width}-${height}`), options: { width, height } });
      for (const frame of rendered.frames) {
        const node = frame.nodes.cube, label = `${width}x${height} ${frame.camera.name}`;
        assert.deepEqual(node.bounds.size, [1, 1, 1]); assert.equal(node.triangles, 12);
        assert.equal(node.inFrustum, true, label); assert.equal(node.projectionStatus, 'projected', label);
        assert.ok(node.projection.min[0] >= 0 && node.projection.min[1] >= 0, `${label}: ${JSON.stringify(node.projection)}`);
        assert.ok(node.projection.max[0] <= width && node.projection.max[1] <= height, `${label}: ${JSON.stringify(node.projection)}`);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid camera fov and degenerate camera pose fail rather than produce successful empty frames', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-camera-invalid-'));
  try {
    const doc = document([]);
    for (const [index, camera] of [
      { name: 'custom', fov: 0 },
      { name: 'custom', position: [0, 0, 0], target: [0, 0, 0] },
      { name: 'custom', near: 5, far: 2 },
    ].entries()) {
      await assert.rejects(renderScene({ document: doc, times: [0], cameras: [camera], outputDir: join(directory, String(index)), options: { width: 160, height: 160 } }), /Camera|camera/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('camera-plane bounds report unavailable projection and zero opacity does not distort fitting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-projection-'));
  try {
    const text = { content: 'Visible', color: '#103db0', fontSize: .3, width: 1, align: 'center' };
    const coplanar = document([instance('plane', { position: [0, 0, 2], text })]);
    const projected = await renderScene({ document: coplanar, times: [0], cameras: ['qr'], outputDir: join(directory, 'coplanar'), options: { width: 160, height: 160 } });
    assert.equal(projected.frames[0].nodes.plane.projection, null);
    assert.equal(projected.frames[0].nodes.plane.projectionStatus, 'outside-depth-range');
    assert.equal(projected.frames[0].nodes.plane.inFrustum, false);
    const faded = document([instance('visible', { text }), instance('faded', { position: [10000, 0, 0], opacity: 0, text })]);
    const fitted = await renderScene({ document: faded, times: [0], cameras: ['front'], outputDir: join(directory, 'faded'), options: { width: 160, height: 160 } });
    assert.equal(fitted.frames[0].nodes.faded.visible, false);
    assert.equal(fitted.frames[0].camera.target[0], 0, 'fully transparent authored nodes do not affect visual framing');
    assert.ok(fitted.frames[0].nodes.faded.bounds, 'geometry is still available for explicit inspection');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('audio marker geometry is excluded from real asset bounds and triangle facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-audio-facts-'));
  try {
    const file = join(directory, 'tone.wav'), samples = 4000, bytes = Buffer.alloc(44 + samples * 2);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
    await writeFile(file, bytes);
    const doc = document([instance('audio', { asset: 'audio' })]);
    doc.content.assets.audio = { assetId: '00000000-0000-4000-8000-000000000001' };
    const rendered = await renderScene({ document: doc, resources: { audio: { kind: 'audio', url: file } }, times: [0], cameras: ['front'], outputDir: join(directory, 'render'), options: { width: 160, height: 160 } });
    const facts = rendered.frames[0].nodes.audio;
    assert.equal(facts.audioMarker, true); assert.equal(facts.bounds, null); assert.equal(facts.triangles, 0);
    assert.equal(facts.projection, null); assert.equal(facts.inFrustum, false); assert.equal(facts.visible, false);
    assert.ok(Math.abs(facts.media.durationSeconds - .5) < .001);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
