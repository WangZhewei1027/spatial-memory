import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { stdio: 'inherit' });
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(root, 'dist/index.js'), bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', sourcemap: true, treeShaking: true });
// Explicit JS suffixes also make the declarations consumable with NodeNext resolution.
for (const name of await readdir(join(root, 'dist/types'))) {
  if (!name.endsWith('.d.ts')) continue;
  const path = join(root, 'dist/types', name), source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/(from\s+["'])(\.\/[\w-]+)(["'])/g, '$1$2.js$3'));
}
