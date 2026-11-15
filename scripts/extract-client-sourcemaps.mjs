// Move client source maps out of the publicly served .next/static directory.
// /api/errors reads them from .next/client-sourcemaps to map browser stacks;
// keeping them unserved avoids publishing the application source.
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const STATIC_DIR = ".next/static";
const TARGET_DIR = ".next/client-sourcemaps";

await rm(TARGET_DIR, { recursive: true, force: true });
let count = 0;
async function extract(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await extract(path);
    else if (entry.name.endsWith(".map")) {
      const target = join(TARGET_DIR, relative(STATIC_DIR, path));
      await mkdir(dirname(target), { recursive: true });
      await rename(path, target);
      count++;
    }
  }
}
await extract(STATIC_DIR);
// No maps means next.config.ts no longer emits them and stacks stay minified.
if (!count) {
  console.error(`No client source maps found under ${STATIC_DIR}; check the webpack devtool in next.config.ts`);
  process.exitCode = 1;
} else console.log(`Moved ${count} client source maps to ${TARGET_DIR}`);
