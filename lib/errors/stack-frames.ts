// Rewrite minified browser stack frames to their original source positions.
// Pure: the caller supplies the source map lookup.

export interface OriginalPosition {
  source: string;
  line: number;
  /** 0-based, as returned by source maps. */
  column: number;
  name?: string | null;
}

/** Look up a position in a client chunk; `file` is relative to `/_next/static/`. */
export type PositionResolver = (file: string, line: number, column: number) => Promise<OriginalPosition | null>;

/** Bound the work one anonymous report can trigger. */
export const MAX_SYMBOLICATED_FRAMES = 30;
/** Each distinct chunk loads and parses a source map; frames beyond this stay minified. */
export const MAX_SYMBOLICATED_FILES = 8;

// Chrome `at fn (https://host/_next/static/chunks/x.js:1:234)` and
// Firefox/Safari `fn@https://host/_next/static/chunks/x.js:1:234`.
const FRAME_URL = /(?:https?:\/\/[^\s/()]+)?\/_next\/static\/([A-Za-z0-9_\-.~%/]+?\.js):(\d+):(\d+)/g;

/** Static chunk path, decoded, or null when it could escape the static directory. */
export function chunkFile(raw: string): string | null {
  let file: string;
  try {
    file = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (file.includes("\0") || file.includes("\\") || file.startsWith("/")) return null;
  if (file.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  return file;
}

/** `webpack://_N_E/./app/page.tsx?abc` → `app/page.tsx`. */
export function cleanSourcePath(source: string): string {
  return source
    .replace(/^webpack:\/\/[^/]*\//, "")
    .replace(/^(\.\/)+/, "")
    .replace(/\?.*$/, "");
}

/**
 * Replace each resolvable chunk position with `source:line:column` (1-based
 * column, like the browser). Returns null when no frame resolved.
 */
export async function symbolicateStack(stack: string, resolve: PositionResolver): Promise<string | null> {
  const matches = [...stack.matchAll(FRAME_URL)].slice(0, MAX_SYMBOLICATED_FRAMES);
  if (!matches.length) return null;
  const files = new Set<string>();
  const replacements = await Promise.all(matches.map(async (match) => {
    const file = chunkFile(match[1]);
    const line = Number(match[2]);
    const column = Number(match[3]);
    if (!file || line < 1 || column < 1) return null;
    if (!files.has(file)) {
      if (files.size >= MAX_SYMBOLICATED_FILES) return null;
      files.add(file);
    }
    try {
      const position = await resolve(file, line, column - 1);
      if (!position) return null;
      const name = position.name ? ` [${position.name}]` : "";
      return `${cleanSourcePath(position.source)}:${position.line}:${position.column + 1}${name}`;
    } catch {
      return null;
    }
  }));
  if (replacements.every((value) => value === null)) return null;

  let result = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    result += stack.slice(cursor, start) + (replacements[index] ?? match[0]);
    cursor = start + match[0].length;
  });
  return result + stack.slice(cursor);
}
