import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Build identifier stamped on every error_log row. Docker builds have no .git,
// so the deploy pipeline passes the commit as APP_RELEASE.
function resolveRelease(): string {
  if (process.env.APP_RELEASE) return process.env.APP_RELEASE;
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

const withMDX = createMDX({
  options: {
    // String form required for Turbopack compatibility
    remarkPlugins: [["remark-gfm"]],
  },
});

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
  // Keep the local development indicator clear of the editor playback controls.
  devIndicators: { position: "bottom-right" },
  // Node-only server deps: keep them out of the bundle (ali-oss lazily requires
  // optional proxy modules that Turbopack cannot resolve; pg has pg-native;
  // undici ships wasm and is used for the model keep-alive agent).
  serverExternalPackages: ["ali-oss", "pg", "nodemailer", "undici", "playwright-core"],
  // The model renderer reads these trusted browser modules at runtime; they are
  // not imported into either the Next server bundle or the client application.
  outputFileTracingIncludes: {
    "/api/upload": [
      "./lib/upload/model-thumbnail-renderer.mjs",
      "./node_modules/three/build/three.module.js", "./node_modules/three/build/three.core.js",
      "./node_modules/three/examples/jsm/loaders/GLTFLoader.js", "./node_modules/three/examples/jsm/loaders/DRACOLoader.js",
      "./node_modules/three/examples/jsm/utils/BufferGeometryUtils.js", "./node_modules/three/examples/jsm/utils/SkeletonUtils.js",
      "./node_modules/three/examples/jsm/environments/RoomEnvironment.js",
      "./node_modules/three/examples/jsm/libs/meshopt_decoder.module.js",
      "./node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js",
      "./node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm",
    ],
  },
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  env: { NEXT_PUBLIC_APP_RELEASE: resolveRelease() },
  // Client source maps without a sourceMappingURL comment; the build moves them
  // out of the public static directory so only /api/errors reads them
  // (scripts/extract-client-sourcemaps.mjs).
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) config.devtool = "hidden-source-map";
    return config;
  },
  cacheComponents: true,
  // Upload is excluded from proxy.ts: large originals stream directly to disk.
  // Preserve this buffer bound for other proxied routes.
  experimental: { proxyClientMaxBodySize: "34mb" },
  turbopack: {
    root: projectRoot,
  },
};

export default withMDX(nextConfig);
