import { build } from '../../node_modules/esbuild/lib/main.js';
import { mkdir, cp, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(new URL('./dist', import.meta.url), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('./src/browser.js', import.meta.url))], outfile: fileURLToPath(new URL('./dist/browser.js', import.meta.url)), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: false,
  tsconfig: `${root}/tsconfig.json`, define: { 'process.env.NEXT_PUBLIC_MEDIA_BASE_URL': '""' },
  alias: { '@spatial-memory/scene-core': `${root}/packages/scene-core/index.js` } });
for (const name of ['index.js', 'index.d.ts']) await copyFile(new URL(`./src/${name}`, import.meta.url), new URL(`./dist/${name}`, import.meta.url));
await cp(new URL('../../node_modules/three/examples/jsm/libs/draco/gltf/', import.meta.url), new URL('./dist/draco/', import.meta.url), { recursive: true });
