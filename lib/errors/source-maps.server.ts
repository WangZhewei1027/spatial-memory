import "server-only";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { symbolicateStack, type PositionResolver } from "./stack-frames";

/**
 * Client source maps moved out of the public static directory at build time
 * (scripts/extract-client-sourcemaps.mjs). Absent in `next dev`, where stacks
 * already point at original sources.
 */
export const CLIENT_SOURCEMAP_DIR = join(process.cwd(), ".next", "client-sourcemaps");

const MAX_CACHED_MAPS = 32;

/** Resolve chunk positions from `<dir>/<chunk>.map`, caching parsed maps (LRU). */
export function createSourceMapResolver(dir: string): PositionResolver {
  const root = resolve(dir);
  const cache = new Map<string, Promise<TraceMap | null>>();

  const load = (file: string): Promise<TraceMap | null> => {
    const cached = cache.get(file);
    if (cached) {
      cache.delete(file);
      cache.set(file, cached);
      return cached;
    }
    const path = resolve(root, `${file}.map`);
    const pending = path.startsWith(root + sep)
      ? readFile(path, "utf8").then((text) => new TraceMap(text), () => null)
      : Promise.resolve(null);
    cache.set(file, pending);
    if (cache.size > MAX_CACHED_MAPS) cache.delete(cache.keys().next().value as string);
    return pending;
  };

  return async (file, line, column) => {
    const map = await load(file);
    if (!map) return null;
    const position = originalPositionFor(map, { line, column });
    if (position.source == null || position.line == null || position.column == null) return null;
    return { source: position.source, line: position.line, column: position.column, name: position.name };
  };
}

const resolveClientPosition = createSourceMapResolver(CLIENT_SOURCEMAP_DIR);

/** Original-source version of a browser stack, or null when nothing maps. */
export function symbolicateClientStack(stack: string): Promise<string | null> {
  return symbolicateStack(stack, resolveClientPosition);
}
