import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { chromium } from 'playwright';

const ownDir = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const mime = file => ({ '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.js': 'text/javascript', '.wasm': 'application/wasm' }[extname(file).toLowerCase()] ?? 'application/octet-stream');
const slug = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

async function fingerprint(file) {
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; digest.update(chunk); }
  return { sha256: digest.digest('hex'), sizeBytes: bytes };
}

async function snapshotResource(resource, destination, timeoutMs) {
  const source = resource.url;
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Resource download failed: HTTP ${response.status} (${resource.assetId ?? resource.kind})`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx' }));
    return { ...await fingerprint(destination), mimeType: response.headers.get('content-type')?.split(';')[0] ?? mime(destination) };
  }
  const sourcePath = source.startsWith('file:') ? fileURLToPath(source) : resolve(source);
  await copyFile(sourcePath, destination);
  return { ...await fingerprint(destination), mimeType: mime(sourcePath) };
}

async function browserPath(explicit) {
  if (explicit) return explicit;
  if (process.env.SPATIAL_MEMORY_CHROMIUM_PATH) return process.env.SPATIAL_MEMORY_CHROMIUM_PATH;
  try { await access(chromium.executablePath()); return undefined; } catch { /* Try installed browsers before requesting a download. */ }
  for (const candidate of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    try { await access(candidate); return candidate; } catch { /* Next installed candidate. */ }
  }
  throw new Error('Chromium is unavailable. Install Chrome, run npx playwright install chromium, or set SPATIAL_MEMORY_CHROMIUM_PATH.');
}

async function requireEmbeddedModel(file) {
  const bytes = await readFile(file);
  let source = bytes;
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x46546c67) {
    if (bytes.length < 20 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a || bytes.readUInt32LE(12) > bytes.length - 20) throw new Error('Invalid model GLB header');
    source = bytes.subarray(20, 20 + bytes.readUInt32LE(12));
  }
  let model;
  try { model = JSON.parse(source.toString('utf8')); } catch { throw new Error('Invalid model JSON'); }
  const dependencies = [];
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'uri' && typeof item === 'string' && !item.startsWith('data:')) dependencies.push(item);
      else if (typeof item === 'object') inspect(item);
    }
  };
  inspect(model);
  if (dependencies.length) throw new Error(`MISSING_DEPENDENCIES: model references external files: ${dependencies.join(', ')}. Supply a self-contained GLB or embedded glTF.`);
}

function serveFile(request, response, file, contentType, bytes) {
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = bytes - 1;
  if (range) {
    if (!range[1]) start = Math.max(0, bytes - Number(range[2]));
    else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    if (!Number.isSafeInteger(start) || start > end || start >= bytes) { response.writeHead(416, { 'content-range': `bytes */${bytes}` }); response.end(); return; }
  }
  response.writeHead(range ? 206 : 200, { 'content-type': contentType, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-store', ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes}` } : {}) });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file, { start, end }).on('error', () => response.destroy()).pipe(response);
}

export async function renderScene(input) {
  const { document, resources = {}, times, cameras = ['audience', 'top', 'side'], options = {} } = input;
  if (!document || !Array.isArray(times) || !times.length || times.some(t => !Number.isFinite(t) || t < 0)) throw new Error('render requires a document and nonnegative finite sample times');
  if (!cameras.length) throw new Error('render requires at least one camera');
  const width = options.width ?? 720, height = options.height ?? 960, timeoutMs = options.timeoutMs ?? 60000;
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('Image width and height must be positive integers');
  const outputDir = resolve(input.outputDir), cacheDir = join(outputDir, '.resources', randomUUID());
  await mkdir(cacheDir, { recursive: true });
  const token = randomUUID(), files = new Map(), resolvedResources = {}, facts = {};
  let index = 0;
  for (const [alias, resource] of Object.entries(resources)) {
    if (!resource || typeof resource.url !== 'string') throw new Error(`Missing URL for resource ${alias}`);
    const extension = extname(resource.url.split('?')[0]) || ({ model: '.glb', image: '.png', audio: '.mp3', video: '.mp4' }[resource.kind]);
    const target = join(cacheDir, `${index++}${extension}`);
    const info = await snapshotResource(resource, target, timeoutMs);
    if (resource.contentHash !== undefined) {
      if (typeof resource.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(resource.contentHash)) throw new Error(`Invalid resource SHA256: ${alias}`);
      if (info.sha256 !== resource.contentHash.toLowerCase()) throw new Error(`Resource changed since inspection: ${alias}`);
    }
    if (resource.kind === 'model') await requireEmbeddedModel(target);
    const route = `/r/${token}/${basename(target)}`;
    files.set(route, { file: target, ...info });
    resolvedResources[alias] = { ...resource, url: route };
    facts[alias] = { assetId: resource.assetId, kind: resource.kind, ...info };
  }
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#edf0f4}#stage{position:relative;width:${width}px;height:${height}px}canvas{position:absolute;left:0;top:0;width:100%;height:100%}</style><div id="stage"><canvas id="scene"></canvas><canvas id="overlay"></canvas></div><script src="/browser.js"></script>`;
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (path === `/${token}`) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); return; }
      let item = files.get(path);
      if (path === '/browser.js') item = { file: join(ownDir, 'browser.js'), mimeType: 'text/javascript' };
      if (/^\/draco\/[a-zA-Z0-9_.-]+$/.test(path)) item = { file: join(ownDir, path), mimeType: mime(path) };
      if (!item) { response.writeHead(404); response.end('Unknown snapshot resource'); return; }
      serveFile(request, response, item.file, item.mimeType, item.sizeBytes ?? (await stat(item.file)).size);
    } catch { response.writeHead(500); response.end('Snapshot resource unavailable'); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: await browserPath(options.executablePath), args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const diagnostics = [];
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      diagnostics.push({ code: 'UNSNAPSHOTTED_RESOURCE', message: `Resource is outside this snapshot: ${url.origin}${url.pathname}` });
      return route.abort('blockedbyclient');
    });
    page.on('pageerror', error => diagnostics.push({ code: 'BROWSER_ERROR', message: error.message }));
    await page.goto(`${origin}/${token}`);
    await page.waitForFunction(() => !!window.sceneRenderer, undefined, { timeout: timeoutMs });
    await page.evaluate(async payload => window.sceneRenderer.load(payload), { document, resources: resolvedResources, options: { ...options, width, height, timeoutMs } });
    const documentHash = hash(JSON.stringify(document)), images = [], frames = [];
    for (const time of times) for (const camera of cameras) {
      const frame = await page.evaluate(async args => window.sceneRenderer.frame(args), { time, camera, overlays: !!options.overlays });
      if (diagnostics.length) throw new Error(diagnostics.map(d => d.message).join('; '));
      const name = typeof camera === 'string' ? camera : camera.name ?? 'custom';
      const target = join(outputDir, `${String(images.length).padStart(3, '0')}-t${slug(time)}-${slug(name)}.png`);
      const bytes = await page.locator('#stage').screenshot({ path: target, timeout: timeoutMs });
      images.push({ path: target, mimeType: 'image/png', time: frame.time, camera: name, width, height, sha256: hash(bytes) });
      frames.push(frame);
    }
    const manifest = join(outputDir, 'render.json');
    const result = { images, manifest, documentHash, revision: options.revision, resources: facts, frames, diagnostics, rendererVersion: '0.1.0', browserVersion: browser.version() };
    await writeFile(manifest, `${JSON.stringify(result, null, 2)}\n`);
    await page.evaluate(() => window.sceneRenderer.dispose());
    return result;
  } finally {
    await browser?.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

export async function probeAsset(input) {
  const source = input.path ?? input.url;
  if (!source) throw new Error('probeAsset requires path or url');
  const extension = extname(source.split('?')[0]).toLowerCase();
  const kind = input.kind ?? (['.glb', '.gltf'].includes(extension) ? 'model' : ['.mp3', '.wav', '.ogg', '.m4a', '.flac'].includes(extension) ? 'audio' : ['.mp4', '.webm', '.mov'].includes(extension) ? 'video' : 'image');
  const outputDir = input.outputDir ?? resolve('.spatial-memory', 'previews', randomUUID());
  const instance = { id: 'asset', asset: 'asset', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: null };
  const document = { schemaVersion: 6, content: { kind: 'composition', units: 'meters', durationSeconds: 10, loop: false, assets: { asset: { assetId: '00000000-0000-4000-8000-000000000001' } }, instances: [instance] } };
  const result = await renderScene({ document, resources: { asset: { url: source, kind } }, times: [0], cameras: ['front'], outputDir, options: { width: 640, height: 640, ...input.options } });
  const node = result.frames[0].nodes.asset;
  return { facts: { kind, ...result.resources.asset, bounds: node.bounds, units: kind === 'model' ? 'unknown' : kind === 'audio' ? 'not-applicable' : 'meters-in-scene', triangles: node.triangles, ...(node.audioMarker ? { audioMarker: true } : {}),
    animations: node.animations.map((clip, index) => ({ index, name: clip.name, duration_seconds: clip.duration })),
    ...(node.source ?? {}), ...(node.media ? { durationSeconds: node.media.durationSeconds, width: node.media.width, height: node.media.height } : {}) }, previews: result.images, errors: result.diagnostics, manifest: result.manifest };
}
