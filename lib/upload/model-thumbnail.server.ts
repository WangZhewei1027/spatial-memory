import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { ContentError } from "@/lib/content-model/errors";

const ORIGIN = "https://model-thumbnail.invalid";
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;
let active = false;

// An exact allowlist, never a filesystem path derived from the uploaded model.
const MODULES = [
  "build/three.module.js", "build/three.core.js",
  "examples/jsm/loaders/GLTFLoader.js", "examples/jsm/loaders/DRACOLoader.js",
  "examples/jsm/utils/BufferGeometryUtils.js", "examples/jsm/utils/SkeletonUtils.js",
  "examples/jsm/environments/RoomEnvironment.js",
  "examples/jsm/libs/meshopt_decoder.module.js",
  "examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js",
  "examples/jsm/libs/draco/gltf/draco_decoder.wasm",
] as const;
const HTML = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module" src="/renderer.mjs"></script>`;

/** Inspect the glTF envelope before giving bytes to a renderer. External URLs and
 * sibling files are unsupported: an uploaded asset must be self-contained. */
function validateModel(buffer: Buffer): void {
  if (!buffer.length || buffer.length > MAX_INPUT_BYTES)
    throw new ContentError("VALIDATION_FAILED", "模型文件为空或超过 5 MiB 限制", undefined, 413);
  try {
    let json = buffer;
    if (buffer.subarray(0, 4).toString() === "glTF") {
      if (buffer.length < 20 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length || buffer.readUInt32LE(16) !== 0x4e4f534a)
        throw new Error("Invalid GLB header");
      const length = buffer.readUInt32LE(12);
      if (length > buffer.length - 20) throw new Error("Invalid JSON chunk");
      json = buffer.subarray(20, 20 + length);
    }
    const document: unknown = JSON.parse(json.toString("utf8"));
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Invalid glTF");
    const asset = (document as Record<string, unknown>).asset;
    if (!asset || typeof asset !== "object" || (asset as Record<string, unknown>).version !== "2.0") throw new Error("Only glTF 2.0 is supported");
    const gltf = document as Record<string, unknown>;
    if (Array.isArray(gltf.nodes) && gltf.nodes.length > 10_000) throw new Error("Too many model nodes");
    if (Array.isArray(gltf.accessors)) {
      let elements = 0;
      for (const accessor of gltf.accessors) {
        const count: unknown = accessor?.count;
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 2_000_000) throw new Error("Invalid geometry budget");
        elements += count;
      }
      if (elements > 10_000_000) throw new Error("Geometry budget exceeded");
    }
    if (Array.isArray(gltf.buffers) && gltf.buffers.some((buffer) => typeof buffer?.byteLength !== "number" || buffer.byteLength < 0 || buffer.byteLength > 128 * 1024 * 1024))
      throw new Error("Invalid buffer size");
    const pending: unknown[] = [document];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      for (const [key, child] of Object.entries(value)) {
        if (key === "uri" && (typeof child !== "string" || !/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/=\r\n]*$/i.test(child)))
          throw new ContentError("VALIDATION_FAILED", "模型引用了外部文件，请上传包含纹理和几何数据的 GLB 或自包含 glTF");
        if (child && typeof child === "object") pending.push(child);
      }
    }
  } catch (error) {
    if (error instanceof ContentError) throw error;
    throw new ContentError("VALIDATION_FAILED", "模型不是有效的 glTF 2.0 / GLB 文件");
  }
}

/** Render a fixed, lit, animation-free view as a 512 × 512 PNG. Each call owns
 * its browser, including decoder workers and WebGL memory; closing it releases
 * all resources on success, timeout, invalid input, or renderer crash. */
export async function generateModelThumbnail(buffer: Buffer): Promise<Buffer> {
  validateModel(buffer);
  if (active) throw new ContentError("VALIDATION_FAILED", "模型缩略图生成繁忙，请稍后重试", undefined, 429);
  active = true;
  let browser: Browser | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const files = new Map<string, Buffer>(await Promise.all(MODULES.map(async (name) => [
      `${ORIGIN}/three/${name}`, await readFile(join(process.cwd(), "node_modules/three", name)),
    ] as const)));
    const renderer = await readFile(join(process.cwd(), "lib/upload/model-thumbnail-renderer.mjs"));
    try {
      browser = await chromium.launch({
        headless: true, timeout: 20_000,
        // Media decoders do not need application database or cloud credentials.
        env: Object.fromEntries(["PATH", "HOME", "TMPDIR", "SYSTEMROOT"].flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : [])),
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=256"],
      });
    } catch {
      throw new ContentError("INTERNAL", "模型缩略图服务暂不可用，请稍后重试", undefined, 503);
    }
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 512, height: 512 } });
    // No actual HTTP server or outbound request. Every permitted byte is provided
    // from the trusted module map or this call's upload, including Draco WASM.
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url === `${ORIGIN}/`) return route.fulfill({
        body: HTML, contentType: "text/html",
        headers: { "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self' data: blob:; img-src data: blob:; worker-src blob:" },
      });
      if (url === `${ORIGIN}/renderer.mjs`) return route.fulfill({ body: renderer, contentType: "text/javascript" });
      if (url === `${ORIGIN}/model`) return route.fulfill({ body: buffer, contentType: "application/octet-stream" });
      const body = files.get(url);
      if (body) return route.fulfill({ body, contentType: url.endsWith(".wasm") ? "application/wasm" : "text/javascript" });
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    const render = async () => {
      await page.goto(`${ORIGIN}/`, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      await page.waitForFunction(() => "thumbnailResult" in window, undefined, { timeout: RENDER_TIMEOUT_MS });
      const result: unknown = await page.evaluate(() => Reflect.get(window, "thumbnailResult"));
      if (typeof result !== "string" || !result.startsWith("data:image/png;base64,"))
        throw new ContentError("VALIDATION_FAILED", "模型无法生成缩略图，请检查模型、纹理及压缩格式");
      const output = Buffer.from(result.slice("data:image/png;base64,".length), "base64");
      if (!output.length || output.length > 2 * 1024 * 1024) throw new Error("Invalid render output");
      return output;
    };
    return await Promise.race([
      render(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ContentError("VALIDATION_FAILED", "模型缩略图生成超时，请简化模型后重试")), RENDER_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof ContentError) throw error;
    throw new ContentError("VALIDATION_FAILED", "模型无法生成缩略图，请检查模型、纹理及压缩格式");
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close().catch(() => {});
    active = false;
  }
}
